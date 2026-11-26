import { bytesUnder } from "../src/stored.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { follow, type AtlasEvent, type Result } from "@atlas/sdk";
import { faultRun } from "../src/scenario.ts";
import { radioAsset, plugin } from "../src/actors.ts";
import { assetApp } from "../src/asset-app.ts";
import { value } from "../src/world.ts";
import { rules, type RunTrace } from "../src/rules.ts";
faultRun({
  name: "core-and-sdk",
  seeds: [64, 100, 121],
  checks: rules.map((r) => r.checks),
  async run(w, seed) {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    async function known<T>(p: Promise<Result<T>>): Promise<T> {
      let result = await w.complete(p);
      while (!result.ok && result.retry && result.error === "unknown")
        result = await w.complete(result.retry());
      return value(result);
    }
    const assets = [await assetApp(w, { name: "ip-one", equipment: "ardupilot" }), await assetApp(w, { name: "ip-two", equipment: "ardupilot" })];
    const radio = await radioAsset(w);
    const p = await plugin(w, async (call, reply, id) => {
      await reply.answer({
      });
    });
    const operators = [w.admin, w.client("operator-two", { kind: "account" })];
    value(await w.complete(operators[1].connect()));
    value(await w.complete(operators[1].login("ADM", "simulation-password")));
    w.network.seed = seed;
    const handled: Record<string, number[]> = { one: [], two: [] };
    const readers = operators.map((c, i) =>
      follow(c, { after: 0 }, (e) => {
        handled[i ? "two" : "one"].push(e.event_id);
      }),
    );
    for (const reader of readers) w.onClose(() => reader.stop());
    await w.settle();
    const accepted: number[] = [];
    for (let step = 0; step < 6; step++) {
      const asset = assets[Math.floor(random() * assets.length)];
      const operator = operators[step % 2];
      w.trace.inputs.push({
        step,
        seed,
        asset_id: asset.asset_id,
        operator: step % 2,
        task: "hold",
      });
      const sent = await known(
        operator.call("sendTasks", {
          params: { asset_id: asset.asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      );
      accepted.push(sent.event_id);
      await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.asset_id === asset.asset_id && e.record.kind === "task" && e.record.task_id === sent.task_ids[0] && e.record.task_state === "completed"));
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
        body: { tasks: [{ kind: "hold" }], now: true },
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
    await w.until(() => radio.starts.length > 0);
    radio.session.queue!.finish(sent.task_ids[0], "completed");
    await known(
      w.admin.call("callPlugin", {
        params: { plugin_id: p.plugin_id, action: "scan" },
        body: { inputs: [] },
      }),
    );
    w.network.seed = undefined;
    await w.complete(radio.session.outbox.flush());
    await w.until(() => w.events.some((e) => e.kind === "plugin.result"));
    for (const asset of assets) await asset.stop();
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
      ...assets.map((a) => a.asset_id),
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
    for (const caller of ["admin", "operator-two"])
      assert.ok(
        w.network.traffic.some(
          (t) =>
            t.caller === caller &&
            t.faultOrigin === "seed" &&
            (t.streamCuts ?? 0) > 0,
        ),
        `${caller} stream was cut`,
      );
    assert.ok(
      new Set(
        w.network.traffic
          .filter(
            (t) =>
              t.faultOrigin === "seed" &&
              t.fault?.kind === "loseResponse" &&
              t.status &&
              t.status < 300,
          )
          .map((t) => t.path),
      ).size >= 2,
      "responses lost on two routes",
    );
    for (const reader of readers) reader.stop();
    await w.restartCore();
    const zip = (await readdir(join(w.root, "archive"))).find((n) =>
      n.endsWith(".zip"),
    );
    assert.ok(zip);
    const { stdout } = await promisify(execFile)("unzip", [
      "-p",
      join(w.root, "archive", zip),
      "events.jsonl",
    ]);
    const archivedEvents: AtlasEvent[] = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const asset of assets) {
      const starts = archivedEvents.filter(e => e.kind === "report.status" && e.record.asset_id === asset.asset_id && e.record.kind === "task" && e.record.task_state === "active");
      assert.equal(asset.equipment?.targets.length, starts.length, "each active Hold reaches equipment exactly once");
    }
    const trace: RunTrace = {
      reportIds,
      tasks,
      events: archivedEvents,
      starts: [
        ...archivedEvents.flatMap(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_state === "active" && assets.some(a => a.asset_id === e.record.asset_id)
          ? [{ asset_id: e.record.asset_id, task_id: e.record.task_id }] : []),
        ...radio.starts.map((task_id) => ({
          asset_id: radio.asset_id,
          task_id,
        })),
      ],
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
