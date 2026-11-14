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
}) {
  test(spec.name, async () => {
    await checkAnchors(spec.checks);
    const world = await createWorld(spec.config);
    try {
      await spec.run(world);
    } catch (error) {
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
      await world.close();
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
