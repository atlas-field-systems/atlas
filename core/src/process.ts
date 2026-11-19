import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Clock, Timer } from "./clock.ts";
import type { CoreOptions, RunningCore, StopResult } from "./core.ts";

export const executable = fileURLToPath(new URL("../bin/atlas-core", import.meta.url));

function message(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a Core process message");
  }
  return Object.fromEntries(Object.entries(value));
}

// A fired timer resolves when Go acknowledges it. The simulated world uses
// this to finish the callback before advancing to the next deadline.
function serveClock(pipe: Duplex, clock: Clock, failed: (error: unknown) => void) {
  const timers = new Map<number, Timer>();
  const firing = new Map<number, () => void>();
  const send = (value: object) => { pipe.write(JSON.stringify(value) + "\n"); };
  pipe.on("error", failed);

  createInterface({ input: pipe }).on("line", (line) => {
    try {
      const { op, id, at } = message(line);
      if (typeof id !== "number") throw new Error("Core clock message lacks an ID");
      switch (op) {
        case "now":
          send({ op: "time", id, at: clock.now() });
          break;
        case "cancel":
          timers.get(id)?.cancel();
          timers.delete(id);
          firing.get(id)?.();
          firing.delete(id);
          break;
        case "timer": {
          if (typeof at !== "number") throw new Error("Core timer lacks a deadline");
          const fire = () => {
            timers.delete(id);
            const completed = Promise.withResolvers<void>();
            firing.set(id, completed.resolve);
            send({ op: "fire", id, at: clock.now() });
            return completed.promise;
          };
          const delay = at - clock.now();
          if (delay <= 0) void fire();
          else timers.set(id, clock.after(delay, fire));
          break;
        }
        default:
          throw new Error("Unknown Core clock operation");
      }
    } catch (error) {
      failed(error);
    }
  });

  return {
    send,
    close() {
      for (const timer of timers.values()) timer.cancel();
      for (const complete of firing.values()) complete();
      timers.clear();
      firing.clear();
    },
  };
}

export async function startProcess({ config, clock }: CoreOptions): Promise<RunningCore> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-core-config-"));
  try {
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    // Only the standalone CLI applies environment overrides.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ATLAS_CORE_")));
    const child = spawn(executable, [path, "--host-clock"], {
      stdio: ["ignore", "pipe", "pipe", "pipe"], env,
    });
    const pipe = child.stdio[3];
    if (!(pipe instanceof Duplex) || !child.stdout || !child.stderr) {
      child.kill("SIGKILL");
      throw new Error("Core's process pipes could not be opened");
    }

    const ready = Promise.withResolvers<RunningCore>();
    const finished = Promise.withResolvers<StopResult>();
    let result: StopResult | undefined;
    let grace: Timer | undefined;
    let errors = "";
    const connection = serveClock(pipe, clock, failed);
    function failed(error: unknown) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      errors = error instanceof Error ? error.message : String(error);
      child.kill("SIGKILL");
    }

    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      errors = (errors + text).slice(-8192);
      process.stderr.write(text);
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const msg = message(line);
        if (typeof msg.url === "string" && typeof msg.run_id === "number") {
          process.stdout.write(line + "\n");
          ready.resolve({
            url: msg.url,
            runId: msg.run_id,
            debugUrl: typeof msg.debug_url === "string" ? msg.debug_url : null,
            stop() {
              if (!grace) {
                connection.send({ op: "stop" });
                grace = clock.after(5000, () => connection.send({ op: "grace" }));
              }
              return finished.promise;
            },
          });
        } else if (msg.archived === true && typeof msg.zip === "string") {
          result = { archived: true, zip: msg.zip };
        } else if (msg.archived === false && typeof msg.explanation === "string") {
          result = { archived: false, explanation: msg.explanation };
        } else {
          throw new Error("Unrecognized Core process output");
        }
      } catch (error) {
        failed(error);
      }
    });
    child.once("error", ready.reject);
    child.once("close", (code, signal) => {
      grace?.cancel();
      connection.close();
      const error = new Error(errors.trim() || `Core exited with ${signal ?? code}`);
      if (error.message.includes("address already in use")) Object.assign(error, { code: "EADDRINUSE" });
      ready.reject(error);
      finished.resolve(result ?? { archived: false, explanation: error.message });
    });
    return await ready.promise;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
