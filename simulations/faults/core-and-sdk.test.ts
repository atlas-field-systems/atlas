import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { follow, type AtlasEvent, type Result } from "@atlas/sdk";
import { faultRun } from "../src/scenario.ts";
import { ipAsset, radioAsset, plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";
import { rules, type RunTrace } from "../src/rules.ts";
async function bytesUnder(path: string): Promise<Uint8Array[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const result: Uint8Array[] = [];
  for (const e of entries)
    result.push(
      ...(e.isDirectory()
        ? await bytesUnder(join(path, e.name))
        : e.name.endsWith(".zip")
          ? [
              (
                await promisify(execFile)("unzip", ["-p", join(path, e.name)], {
                  encoding: "buffer",
                  maxBuffer: 16 * 1024 * 1024,
                })
              ).stdout,
            ]
          : [await readFile(join(path, e.name))]),
    );
  return result;
}
faultRun({
  name: "core-and-sdk",
  seeds: [7, 42, 2026],
  checks: rules.map((r) => r.checks),
  async run(w, seed) {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    async function known<T>(p: Promise<Result<T>>): Promise<T> {
      let result = await w.complete(p);
      while (!result.ok && result.retry)
        result = await w.complete(result.retry());
      return value(result);
    }
    const assets = [await ipAsset(w, "ip-one"), await ipAsset(w, "ip-two")];
    const radio = await radioAsset(w);
    const p = await plugin(w, async (call, reply, id) => {
      await reply.answer({
        type: "plugin.result",
        time: w.clock.now(),
        plugin_id: call.plugin_id,
      });
    });
    const operators = [w.admin, w.client("operator-two", { kind: "account" })];
    value(await w.complete(operators[1].connect()));
    value(await w.complete(operators[1].login("ADM", "simulation-password")));
    const handled: Record<string, number[]> = { one: [], two: [] };
    const readers = operators.map((c, i) =>
      follow(c, { after: 0 }, (e) => {
        handled[i ? "two" : "one"].push(e.event_id);
      }),
    );
    for (const reader of readers) w.onClose(() => reader.stop());
    w.network.seed = seed;
    const accepted: number[] = [];
    const starts: RunTrace["starts"] = [];
    for (let step = 0; step < 6; step++) {
      const asset = assets[Math.floor(random() * assets.length)];
      const operator = operators[step % 2];
      w.trace.inputs.push({
        step,
        seed,
        asset_id: asset.session.asset_id,
        operator: step % 2,
        task: "hold",
      });
      const sent = await known(
        operator.call("sendTasks", {
          params: { asset_id: asset.session.asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      );
      accepted.push(sent.event_id);
      await w.until(() =>
        asset.session.queue!.held().includes(sent.task_ids[0]),
      );
      const task = asset.session.queue!.next()!;
      starts.push({ asset_id: task.asset_id, task_id: task.task_id });
      asset.session.queue!.finish(task.task_id, "completed");
      if (step === 0)
        w.network.once("admin", "/entities/geofeatures", {
          kind: "loseResponse",
        });
      await known(
        operator.call("createGeofeature", {
          body: {
            kind: "point",
            name: `seed-${seed}-step-${step}`,
            position: { latitude: Math.floor(random() * 20), longitude: 2 },
          },
        }),
      );
    }
    const sent = await known(
      w.admin.call("sendTasks", {
        params: { asset_id: radio.asset_id },
        body: { tasks: [{ kind: "hold" }] },
      }),
    );
    accepted.push(sent.event_id);
    await w.until(() => w.events.some((e) => e.event_id === sent.event_id));
    const request = w.events.find(
      (e): e is AtlasEvent<"tasks.requested"> =>
        e.event_id === sent.event_id && e.kind === "tasks.requested",
    )!;
    radio.deliver(request);
    radio.deliver(request);
    await w.until(() => radio.session.queue!.held().length === 1);
    const task = radio.session.queue!.next()!;
    starts.push({ asset_id: task.asset_id, task_id: task.task_id });
    radio.session.queue!.finish(task.task_id, "completed");
    await known(
      w.admin.call("callPlugin", {
        params: { plugin_id: p.plugin_id, action: "scan" },
        body: { inputs: [] },
      }),
    );
    w.network.seed = undefined;
    for (const asset of assets) await w.complete(asset.session.outbox.flush());
    await w.complete(radio.session.outbox.flush());
    await w.until(() => w.events.some((e) => e.kind === "plugin.result"));
    for (const asset of assets) asset.session.stop();
    radio.close();
    p.session.stop();
    await w.advance(31000);
    const places = value(await w.complete(w.admin.call("geofeatures"))).items;
    await w.until(() =>
      readers.every((r) => r.cursor === w.events.at(-1)?.event_id),
    );
    const reportIds: number[] = [];
    const history = w.admin.history()[Symbol.asyncIterator]();
    for (;;) {
      const page = await w.complete(history.next());
      if (page.done) break;
      reportIds.push(...value(page.value).items.map((e) => e.event_id));
    }
    const tasks: RunTrace["tasks"] = [];
    for (const asset_id of [
      ...assets.map((a) => a.session.asset_id),
      radio.asset_id,
    ]) {
      const read = value(
        await w.complete(w.admin.call("tasks", { params: { asset_id } })),
      );
      tasks.push(
        ...read.items.map((item) => ({
          asset_id,
          task_id: item.task.task_id,
          state: item.state,
        })),
      );
    }
    await w.restartCore();
    const trace: RunTrace = {
      reportIds,
      tasks,
      events: w.events,
      starts,
      accepted,
      handled,
      network: w.network.traffic,
      places,
      secrets: [...w.network.secrets],
      stored: [
        ...(await bytesUnder(join(w.root, "data"))),
        ...(await bytesUnder(join(w.root, "archive"))),
        ...(await bytesUnder(join(w.root, "logs"))),
      ],
    };
    w.trace.fault = trace;
    for (const rule of rules)
      assert.ok(
        rule.check(trace),
        `${rule.name} [${rule.checks}], replay ATLAS_SEED=${seed} npm test`,
      );
  },
});
