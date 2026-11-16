import { test } from "node:test";
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorld, type World } from "./world.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
export function scenario(spec: {
  name: string;
  checks: string[];
  run(world: World): Promise<void>;
  seed?: number;
  config?: Parameters<typeof createWorld>[0];
  demo?: string[];
}) {
  test(spec.name, async () => {
    await checkAnchors(spec.checks);
    const world = await createWorld(spec.config);
    const evidence = spec.demo ? process.env.ATLAS_DEMO_OUTPUT : undefined;
    let failure: unknown;
    try {
      await spec.run(world);
    } catch (error) {
      failure = error;
      await recordFailure(
        spec.name,
        spec.checks,
        error,
        world.root,
        world.trace,
        spec.seed,
      );
      throw error;
    } finally {
      try {
        await world.close(evidence);
      } catch (error) {
        failure = error;
        await recordFailure(
          spec.name,
          spec.checks,
          error,
          world.root,
          world.trace,
          spec.seed,
        );
        throw error;
      } finally {
        if (evidence) {
          const result = failure ? "FAIL" : "PASS";
          const reports = world.events.flatMap(event =>
            event.kind === "report.status" && event.record.kind === "task"
              ? [`- Asset ${event.record.asset_id}, Task ${event.record.task_id}: ${event.record.task_state}`]
              : []);
          const summary = [
            "# Asset reconnect demo", "", `Result: ${result}`, "",
            "Real Core, SDK and Asset app; simulated TCP peripheral, network and time.",
            "This is a settings Task, not a flight or a radio test.", "",
            "## What this scenario checks", "",
            ...spec.demo!.map(step => `- ${step}`), "",
            "## Task reports observed by the operator's event reader", "", ...reports, "",
            ...(failure ? [`Failure: ${String(failure)}`, ""] : []),
            "## Evidence", "",
            "- events.jsonl: domain events seen by the operator's reader.",
            "- archive/: Core's verified Reset ZIP, including its full event log and diagnostics.",
            "- asset-archives/: the Asset's verified Reset ZIP and diagnostics.",
            "Archives may be missing if shutdown failed; see the command output.", "",
          ].join("\n");
          await mkdir(evidence, { recursive: true });
          await writeFile(resolve(evidence, "events.jsonl"), world.events.map(event => JSON.stringify(event)).join("\n") + "\n");
          await writeFile(resolve(evidence, "summary.md"), summary);
          process.stdout.write(`\n${summary}\nEvidence: ${evidence}\n`);
        }
      }
    }
  });
}
export function faultRun(spec: {
  name: string;
  checks: string[];
  seeds: number[];
  run(world: World, seed: number): Promise<void>;
}) {
  const seeds = process.env.ATLAS_SEED
    ? [Number(process.env.ATLAS_SEED)]
    : spec.seeds;
  for (const seed of seeds)
    scenario({
      ...spec,
      name: `${spec.name}-${seed}`,
      seed,
      run: (w) => spec.run(w, seed),
    });
}

export async function checkAnchors(checks: string[]) {
  for (const check of checks) {
    const [path, anchor] = check.split("#");
    const doc = await readFile(resolve(root, path), "utf8");
    const anchors = [...doc.matchAll(/^#+ (.+)$/gm)].map((m) =>
      m[1]
        .toLowerCase()
        .replace(/[^\w\- ]/g, "")
        .replaceAll(" ", "-"),
    );
    if (anchor && !anchors.includes(anchor))
      throw new Error(`Missing doc anchor ${check}`);
  }
}
export async function recordFailure(
  name: string,
  checks: string[],
  error: unknown,
  sourceRoot: string,
  trace: unknown,
  seed?: number,
) {
  const folder = resolve(
    root,
    "simulations/.runs",
    seed === undefined
      ? `${name.replace(/[^a-z0-9-]/gi, "-")}-0`
      : name.replace(/[^a-z0-9-]/gi, "-"),
  );
  await mkdir(folder, { recursive: true });
  await cp(resolve(sourceRoot, "logs"), resolve(folder, "logs"), {
    recursive: true,
  });
  await writeFile(
    resolve(folder, "failure.json"),
    JSON.stringify(
      {
        seed: seed ?? 0,
        checks: checks,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                expected: "expected" in error ? error.expected : undefined,
                observed: "actual" in error ? error.actual : undefined,
              }
            : String(error),
        trace: trace,
      },
      null,
      2,
    ),
  );
}
