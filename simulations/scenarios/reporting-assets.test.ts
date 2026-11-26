import { once } from "node:events";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, parseConfig } from "@atlas/asset";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
scenario({
  name: "A reporting-only stationary Asset keeps its installed position current",
  checks: ["asset/docs/README.md#position-and-home", "asset/docs/README.md#start-and-connect"],
  async run(w) {
    const app = await assetApp(w, { name: "stationary", config: {
      description: { reports: ["telemetry"], commands: [] }, initial_settings: {},
    } });
    const config = app.config;
    try {
      await w.advance(config.measurement_stale_after_s * 2000);
      const picture = value(await w.complete(w.admin.call("entities")));
      assert.equal(picture.assets.length, 1);
      const telemetry = w.events.filter(e => e.kind === "report.telemetry").at(-1);
      assert.ok(telemetry && telemetry.record.type === "report.telemetry");
      assert.deepEqual(telemetry.record.position, { latitude: 1, longitude: 2 });
      assert.ok(telemetry.record.time > w.clock.now() - config.measurement_stale_after_s * 1000);
      assert.equal(w.events.some(e => e.kind === "report.settings" || (e.kind === "report.status" && e.record.kind === "queue")), false);
    } finally { await w.complete(app.stop()); }
  },
});

scenario({
  name: "GPS peripheral and detector feed the real Core picture and retain refused captures",
  checks: ["asset/docs/assets.md#local-state-and-data-flow", "asset/docs/README.md#capture-files", "core/docs/api.md#observations"],
  async run(w) {
    const { createServer } = await import("node:net");
    const { unzipSync, strFromU8 } = await import("fflate");
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const apps: Awaited<ReturnType<typeof startApp>>[] = [];
    const servers: ReturnType<typeof createServer>[] = [];
    const sockets = new Set<import("node:net").Socket>();
    try {
      for (const detector of [false, true]) {
        const key = value(await w.complete(w.admin.call("createAssetKey")));
        assert.ok("key" in key);
        let watched = false;
        let send: ((input: unknown) => void) | undefined;
        const server = createServer(socket => {
          sockets.add(socket);
          let input = "";
          socket.on("data", data => {
            input += data.toString();
            const newline = input.indexOf("\n");
            if (!detector && !watched && newline >= 0) {
              assert.match(input.slice(0, newline), /^\?WATCH=.*"enable":true.*"json":true.*;$/);
              watched = true;
            }
          });
          send = input => socket.write(JSON.stringify(input) + "\n");
        });
        servers.push(server);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
          description: { reports: detector ? ["telemetry", "observation"] : ["telemetry", "status"], commands: [], ...(detector ? {} : { subsystems: [{ subsystem_id: "GPS", label: "GPS receiver" }] }) }, initial_settings: {},
          equipment: { kind: detector ? "peripheral" : "gpsd", host: "127.0.0.1", port: address.port, max_message_bytes: 65536, reconnect_s: 1, ...(detector ? { installation_position: { latitude: 3, longitude: 4 } } : { subsystems: { gps: "GPS" } }) },
          log_directory: join(w.root, `peripheral-${detector}-logs`), archive_directory: join(w.root, "archives") });
        const app = await w.complete(startApp(config, { clock: w.clock, fetch: w.network.fetchFor(`peripheral-${detector}`) }));
        apps.push(app);
        await w.until(() => send !== undefined && (detector || watched));
        if (!detector) send!({ class: "TPV", device: "/dev/gps", mode: 2, time: new Date(w.clock.now()).toISOString(), lat: 3, lon: 4 });
        await w.until(() => w.events.some(e => e.kind === "report.telemetry" && e.record.asset_id === app.asset_id));
        if (!detector) {
          const positionTime = w.clock.now();
          send!({ class: "TPV", device: "/dev/gps", mode: 1, time: new Date(positionTime).toISOString(), lat: 9, lon: 9 });
          await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "faulted" && e.record.asset_id === app.asset_id));
          await w.advance(config.measurement_stale_after_s * 1000 + 1);
          assert.equal(w.events.some(e => e.kind === "report.telemetry" && e.record.asset_id === app.asset_id &&
            e.record.position.latitude === 9), false);
        }
        if (detector) {
          const time = w.clock.now();
          send!({ kind: "observation", source: "detector", observation: { type: "report.observation", time,
            kind: "coordinates", observation_id: "O1", position: { latitude: 5, longitude: 6 } } });
          await w.until(() => w.events.some(e => e.kind === "report.observation"));
          send!({ kind: "file", name: "sample.txt", contentType: "text/plain", base64: Buffer.from("captured").toString("base64"),
            place: { kind: "point", position: { latitude: 3, longitude: 4 } } });
          await w.until(() => w.events.some(e => e.kind === "object.stored"));
          const objects = value(await w.complete(w.admin.call("objects")));
          assert.equal(objects.items.length, 1);
          assert.ok(objects.items[0].geofeature_id);
          const place = value(await w.complete(w.admin.call("geofeature", { params: { geofeature_id: objects.items[0].geofeature_id } })));
          assert.equal(place.item.kind, "point");
          w.network.once("peripheral-true", "/objects", { kind: "refuse", status: 403 });
          send!({ kind: "file", name: "refused.txt", contentType: "text/plain", base64: Buffer.from("retained").toString("base64") });
          await w.until(() => w.network.traffic.some(e => JSON.stringify(e).includes("403")));
          const picture = value(await w.complete(w.admin.call("entities")));
          assert.equal(picture.assets.length, 2);
          for (const asset of picture.assets) {
            const position = asset.reports["report.telemetry"];
            assert.ok(position && position.type === "report.telemetry");
            assert.deepEqual(position.position, { latitude: 3, longitude: 4 });
          }
          assert.equal(picture.observations.length, 1);
          assert.equal(picture.observations[0].observation_id, "O1");
          assert.equal(picture.observations[0].time, time);
          const zip = unzipSync(await readFile(await w.complete(app.stop())));
          for (const expected of ["retained", "captured"])
            assert.ok(Object.entries(zip).some(([name, bytes]) => name.startsWith("files/") && strFromU8(bytes) === expected));
        }
      }
    } finally {
      for (const app of apps) await w.complete(app.stop());
      for (const socket of sockets) socket.destroy();
      for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
});
