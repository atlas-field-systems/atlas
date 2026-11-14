import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
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
    for (const check of spec.checks) {
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
    const world = await createWorld(spec.config);
    try {
      await spec.run(world);
    } catch (error) {
      const folder = resolve(
        root,
        "simulations/.runs",
        spec.seed === undefined
          ? `${spec.name.replace(/[^a-z0-9-]/gi, "-")}-0`
          : spec.name.replace(/[^a-z0-9-]/gi, "-"),
      );
      await mkdir(folder, { recursive: true });
      await writeFile(
        resolve(folder, "failure.json"),
        JSON.stringify(
          {
            seed: spec.seed ?? 0,
            checks: spec.checks,
            error:
              error instanceof Error
                ? {
                    message: error.message,
                    stack: error.stack,
                    expected: "expected" in error ? error.expected : undefined,
                    observed: "actual" in error ? error.actual : undefined,
                  }
                : String(error),
            trace: world.trace,
          },
          null,
          2,
        ),
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
