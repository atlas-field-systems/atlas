import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, systemClock, follow, type AtlasEvent } from "@atlas/sdk";
import { loadPackagedProtocol } from "@atlas/protocol";
import { unzipSync, strFromU8 } from "fflate";
import { startApp, parseConfig } from "@atlas/asset";
import { spawnCore } from "../src/core-process.ts";
import { value } from "../src/world.ts";

for (const scenario of ["flight", "battery", "link"] as const)
  test(
    `atlas/first-flight.md and asset/docs/failsafes.md: ${scenario} on real Core, Asset and SITL`,
    { timeout: 180000 },
    async (t) => {
      const cleanup: Array<() => unknown | Promise<unknown>> = [];
      t.after(async () => {
        for (const close of cleanup.reverse()) await close();
      });
      const root = await mkdtemp(join(tmpdir(), "atlas-sitl-flight-"));
      console.log(`Evidence: ${root}`);
      const cache =
        process.env.ATLAS_SITL_DIRECTORY ??
        join(homedir(), ".cache/atlas-sitl");
      await writeFile(
        join(root, "flight.parm"),
        `FS_GCS_ENABLE 1\nFS_GCS_TIMEOUT 5\nSYSID_MYGCS 255\nBATT_CAPACITY ${scenario === "battery" ? 100 : 3300}\n`,
      );
      const sitl = spawn(
        join(cache, "arducopter"),
        [
          "--instance",
          "30",
          "--serial0",
          "tcp:6060",
          "--model",
          "+",
          "--speedup",
          "5",
          "--home",
          "-35.363261,149.165230,584,353",
          "--defaults",
          `${join(cache, "copter.parm")},${join(root, "flight.parm")}`,
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      let diagnostics = "";
      sitl.stdout.on("data", (b) => {
        diagnostics += b;
      });
      sitl.stderr.on("data", (b) => {
        diagnostics += b;
      });
      cleanup.push(async () => {
        sitl.kill("SIGKILL");
        await writeFile(join(root, "sitl.log"), diagnostics);
      });
      await delay(1000);
      const core = await spawnCore(join(root, "core").replace(/\/core$/, ""), {
        offline_after_s: 10,
      });
      cleanup.push(() => core.stop());
      let cookie = "";
      const accountFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set("cookie", cookie);
        const r = await fetch(input, { ...init, headers });
        const next = r.headers.get("set-cookie");
        if (next) cookie = next.split(";")[0];
        return r;
      };
      const admin = createClient({
        baseUrl: core.url,
        credential: { kind: "account" },
        protocol: await loadPackagedProtocol(),
        clock: systemClock,
        fetch: accountFetch,
      });
      cleanup.push(() => admin.close());
      value(await admin.connect());
      value(await admin.login("ADM", "simulation-password"));
      const issued = value(await admin.call("createAssetKey"));
      if (!("key" in issued)) throw new Error("no key");
      const linkController = new AbortController();
      const assetFetch: typeof fetch = (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            linkController.signal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
      const config = parseConfig({
        ...JSON.parse(
          await readFile(
            new URL("../../asset/examples/copter.json", import.meta.url),
            "utf8",
          ),
        ),
        equipment: {
          kind: "ardupilot",
          host: "127.0.0.1",
          port: 6060,
          system_id: 255,
          heartbeat_s: 0.2,
        },
        asset_key: issued.key,
        link: { core_url: core.url },
        log_directory: join(root, "asset"),
        archive_directory: join(root, "archives"),
      });
      if (scenario === "battery")
        config.initial_settings.failsafe_policy!.push({
          rule_id: "LB",
          priority: 50,
          conditions: [
            { kind: "battery_below", battery_percent: 99 },
            { kind: "airborne" },
          ],
          response: { kind: "land" },
        });
      if (scenario === "link") {
        config.initial_settings.link_loss_after_s = 2;
        config.initial_settings.failsafe_policy!.push({
          rule_id: "LINK",
          priority: 50,
          conditions: [{ kind: "contact_lost" }, { kind: "airborne" }],
          response: { kind: "land" },
        });
      }
      const events: AtlasEvent[] = [];
      const audit = follow(admin, { after: 0 }, (event) => {
        events.push(event);
      });
      cleanup.push(() => audit.stop());
      const app = await startApp(config, { fetch: assetFetch });
      cleanup.push(() => app.stop());
      await delay(12000);
      if (scenario !== "flight") {
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: {
              tasks: [
                {
                  kind: "takeoff",
                  target_altitude: {
                    altitude_m: 5,
                    altitude_reference: "launch",
                  },
                },
              ],
            },
          }),
        );
        const until = async (predicate: () => boolean) => {
          const deadline = Date.now() + 60000;
          while (!predicate()) {
            if (Date.now() > deadline) throw new Error(`${scenario} timeout`);
            await delay(100);
          }
        };
        await until(() => app.state.measurements.airborne?.value === true);
        if (scenario === "link") linkController.abort();
        await until(() => app.state.mode.kind === "shutting_down");
        assert.equal(app.state.locked, true);
        assert.equal(app.state.measurements.armed?.value, false);
        const archive = await app.stop();
        const zipped = unzipSync(await readFile(archive));
        const diagnostics = Object.entries(zipped)
          .filter(([name]) => name.startsWith("diagnostics/"))
          .map(([, data]) => strFromU8(data))
          .join("");
        assert.match(
          diagnostics,
          new RegExp(`"rule_id":"${scenario === "battery" ? "LB" : "LINK"}"`),
        );
        assert.match(diagnostics, /"task_state":"completed"/);
        console.log(JSON.stringify({ scenario, archive }));
        return;
      }
      const tasks = value(
        await admin.call("sendTasks", {
          params: { asset_id: app.asset_id },
          body: {
            tasks: [
              {
                kind: "takeoff",
                target_altitude: {
                  altitude_m: 5,
                  altitude_reference: "launch",
                },
              },
              {
                kind: "move_to",
                destination: {
                  latitude: -35.3632,
                  longitude: 149.16523,
                  altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
                },
              },
              { kind: "land" },
            ],
          },
        }),
      );
      async function waitForDone() {
        const end = Date.now() + 100000;
        while (Date.now() < end) {
          const reports = events
            .filter((e) => e.kind === "report.status")
            .map((e) => e.record);
          const finals = reports.filter(
            (r) =>
              "type" in r &&
              r.type === "report.status" &&
              "task_state" in r &&
              r.task_state !== "active",
          );
          if (finals.length >= 3) return finals;
          await delay(100);
        }
        throw new Error(
          `flight timeout: ${JSON.stringify(events.slice(-12))}\n${diagnostics.slice(-2000)}`,
        );
      }
      const finals = await waitForDone();
      await writeFile(
        join(root, "events.json"),
        JSON.stringify(events, null, 2),
      );
      assert.deepEqual(
        finals.map((r) => ("task_state" in r ? r.task_state : null)),
        ["completed", "completed", "completed"],
      );
      console.log(JSON.stringify({ tasks, finals }));
    },
  );
