import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreConfig } from "../../core/src/config.ts";

export async function spawnCore(
  root: string,
  config: Partial<CoreConfig> = {},
) {
  const path = join(root, "config.json");
  await writeFile(join(root, "password"), "simulation-password");
  await writeFile(
    path,
    JSON.stringify({
      listen_address: "127.0.0.1",
      port: 0,
      data_directory: join(root, "data"),
      archive_directory: join(root, "archive"),
      log_directory: join(root, "logs"),
      first_admin: {
        operator_id: "ADM",
        password_file: join(root, "password"),
      },
      ...config,
    }),
  );
  let process: ChildProcess;
  let url = "",
    run_id = 0;
  let diagnostics = "";
  async function start() {
    process = spawn(
      globalThis.process.execPath,
      [fileURLToPath(new URL("../../core/src/main.ts", import.meta.url)), path],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    process.stderr!.on("data", (chunk) => {
      diagnostics += String(chunk);
    });
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error(`Core startup timed out: ${diagnostics}`));
      }, 10000);
      process.once("error", reject);
      process.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Core exited ${code}: ${diagnostics}`));
      });
      process.stdout!.on("data", (chunk) => {
        output += String(chunk);
        for (const line of output.split("\n").slice(0, -1)) {
          try {
            const ready = JSON.parse(line);
            if (ready.url) {
              url = ready.url;
              run_id = ready.run_id;
              clearTimeout(timer);
              resolve();
            }
          } catch {}
        }
      });
    });
  }
  async function signal(name: NodeJS.Signals) {
    if (process.exitCode !== null || process.signalCode !== null)
      return [process.exitCode];
    const exited = once(process, "exit");
    process.kill(name);
    const timer = setTimeout(() => process.kill("SIGKILL"), 10000);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
    }
  }
  await start();
  return {
    get url() {
      return url;
    },
    get run_id() {
      return run_id;
    },
    get diagnostics() {
      return diagnostics;
    },
    start,
    async kill() {
      await signal("SIGKILL");
    },
    async stop() {
      const [code] = await signal("SIGTERM");
      const zips = await readdir(join(root, "archive")).catch(() => []);
      return { code, zips };
    },
  };
}
