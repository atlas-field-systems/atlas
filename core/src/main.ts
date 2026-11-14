#!/usr/bin/env node
/**
 * The shipped program: `node src/main.ts /etc/atlas-core/config.json`.
 *
 * It is the only place that picks the real clock and reads a config file.
 * SIGTERM or SIGINT (docker stop, Ctrl-C) is the admin's deliberate stop, which
 * is Reset (runs-and-identity.md#a-run-and-reset). SIGKILL or a power loss is a
 * crash, and the next start resumes the run.
 */
import { systemClock } from "./clock.ts";
import { readConfigFile, resolveConfig } from "./config.ts";
import { startCore, type RunningCore } from "./core.ts";

let core: RunningCore | undefined;
let stopRequested = false;
let stopping = false;
const stop = async (running: RunningCore) => {
  if (stopping) return; // a second signal does not start a second Reset
  stopping = true;
  try {
    const result = await running.stop();
    if (!result.archived) process.stderr.write(result.explanation + "\n");
    process.exit(result.archived ? 0 : 1);
  } catch (error) {
    process.stderr.write(
      `Reset failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
};
// Installed before startup so a stop that arrives while Core starts is still a Reset, not a kill.
const requestStop = () => {
  stopRequested = true;
  if (core) void stop(core);
};
process.on("SIGTERM", requestStop);
process.on("SIGINT", requestStop);

const resolved = resolveConfig(
  await readConfigFile(
    process.argv[2] ?? "/etc/atlas-core/config.json",
    process.env,
  ),
);
if (!resolved.ok) {
  for (const p of resolved.problems)
    console.error(`config ${p.key}: ${p.explanation}`);
  process.exit(2);
}

core = await startCore({ clock: systemClock, config: resolved.config });
if (stopRequested) void stop(core);
