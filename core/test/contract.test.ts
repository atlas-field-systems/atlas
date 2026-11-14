import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  readdir,
  mkdtemp,
  writeFile,
  rm,
  chmod,
  stat,
  copyFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startCore } from "../src/core.ts";
import { readZip } from "../src/reset/zip.ts";
import { checkZip } from "../src/reset/reset.ts";
import { clock, stopCore } from "./harness.ts";
import { startHarness, password, protocol } from "./harness.ts";

test("1. issuance retry acknowledges; replacement rejects old keys [api.md#credential-retry-scenarios]", async () => {
  const h = await startHarness();
  try {
    for (const resource of ["asset-keys", "gateways", "plugins"]) {
      const path = "/administration/" + resource;
      const first = await h.call("POST", path, {
        cookie: h.admin,
        idem: resource,
      });
      assert.equal(first.status, 201);
      assert.match(first.body.key, /^[A-Za-z0-9_-]{22}$/);
      const repeat = await h.call("POST", path, {
        cookie: h.admin,
        idem: resource,
      });
      assert.equal(repeat.status, 201);
      assert.equal(repeat.body.key, undefined);
      assert.equal(repeat.body.issued, true);
      const id =
        first.body.key_id ?? first.body.gateway_id ?? first.body.plugin_id;
      const next = await h.call("POST", `${path}/${id}/key`, {
        cookie: h.admin,
        idem: resource + "replace",
      });
      assert.equal(next.status, 200);
      assert.notEqual(next.body.key, first.body.key);
      assert.equal(
        (await h.call("GET", "/about", { key: first.body.key })).status,
        401,
      );
      assert.equal(
        (await h.call("GET", "/about", { key: next.body.key })).status,
        200,
      );
      assert.equal(
        (
          await h.call("POST", `${path}/${id}/key`, {
            cookie: h.admin,
            idem: resource + "replace",
          })
        ).body.key,
        undefined,
      );
      assert.equal(
        (await h.call("GET", "/about", { key: next.body.key })).status,
        200,
      );
    }
    const operator = await h.call("POST", "/administration/accounts", {
      cookie: h.admin,
      body: { operator_id: "OP1", password, admin: false },
    });
    assert.equal(operator.status, 201);
    const login = await h.call("POST", "/administration/login", {
      body: { operator_id: "OP1", password },
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await h.call("POST", "/administration/gateways", { cookie })).status,
      403,
    );
    assert.equal(
      (await h.call("GET", "/administration/me", { cookie })).body.admin,
      false,
    );
  } finally {
    await h.close();
  }
});

test("2. login retry omits cookie and verifies password [api.md#credential-retry-scenarios]", async () => {
  const h = await startHarness();
  try {
    const body = { operator_id: "ADM", password };
    const first = await h.call("POST", "/administration/login", {
      idem: "login",
      body,
    });
    assert.match(
      first.headers.get("set-cookie")!,
      /HttpOnly; Secure; SameSite=Strict/,
    );
    const repeat = await h.call("POST", "/administration/login", {
      idem: "login",
      body,
    });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.headers.get("set-cookie"), null);
    assert.equal(
      (
        await h.call("POST", "/administration/login", {
          idem: "login",
          body: { ...body, password: "wrong" },
        })
      ).status,
      409,
    );
    const next = await h.call("POST", "/administration/login", { body });
    assert.notEqual(
      next.headers.get("set-cookie"),
      first.headers.get("set-cookie"),
    );
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await h.call("GET", "/administration/me", { cookie })).status,
      200,
    );
    assert.equal(
      (await h.call("POST", "/administration/logout", { cookie })).status,
      200,
    );
    assert.equal(
      (await h.call("GET", "/administration/me", { cookie })).status,
      401,
    );
    assert.equal((await h.call("GET", "/administration/me")).status, 401);
  } finally {
    await h.close();
  }
});

test("3. stored state and diagnostics contain no credentials [api.md#credential-retry-scenarios]", async () => {
  const h = await startHarness();
  try {
    const issued = await h.call("POST", "/administration/gateways", {
      cookie: h.admin,
      idem: "issue",
    });
    await h.call("POST", "/administration/gateways", {
      cookie: h.admin,
      idem: "issue",
    });
    const replaced = await h.call(
      "POST",
      `/administration/gateways/${issued.body.gateway_id}/key`,
      { cookie: h.admin },
    );
    await h.stop();
    const secrets = [
      password,
      h.admin.slice("atlas_session=".length),
      issued.body.key,
      replaced.body.key,
    ];
    async function inspect(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.name !== "first-password") {
          const bytes = await readFile(path);
          for (const secret of secrets)
            assert.equal(
              bytes.includes(Buffer.from(secret)),
              false,
              `${path} leaked a credential`,
            );
        }
      }
    }
    await inspect(h.dataDir);
    const archives = await readdir(h.dataDir + "-archive");
    assert.equal(archives.length, 1);
    for (const entry of await readZip(
      join(h.dataDir + "-archive", archives[0]!),
    )) {
      const chunks: Buffer[] = [];
      for await (const chunk of entry.open()) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      for (const secret of secrets)
        assert.equal(bytes.includes(Buffer.from(secret)), false, entry.name);
      assert.doesNotMatch(bytes.toString(), /scrypt\$/);
    }
  } finally {
    await h.close();
  }
});

async function child(configPath: string) {
  const process = spawn(
    globalThis.process.execPath,
    ["src/main.ts", configPath],
    { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let error = "";
  process.stderr.on("data", (c) => (error += c));
  const url = await new Promise<string>((resolve, reject) => {
    process.stdout.on("data", (c) => {
      output += c;
      const line = output.split("\n").find((l) => l.startsWith("{"));
      if (line) {
        try {
          resolve(JSON.parse(line).url);
        } catch {}
      }
    });
    process.once("exit", (code) =>
      reject(new Error(`Core exited ${code}: ${error}`)),
    );
    process.once("error", reject);
  });
  return {
    url,
    process,
    async kill(signal: "SIGKILL" | "SIGTERM") {
      const exited = once(process, "exit");
      process.kill(signal);
      return await exited;
    },
  };
}
test("10. SIGKILL resumes run, session and ID counter [reset.md#when-core-stops-unexpectedly]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-crash-"));
  let running: Awaited<ReturnType<typeof child>> | undefined;
  try {
    await writeFile(join(dir, "pw"), password);
    const cfg = join(dir, "config.json");
    await writeFile(
      cfg,
      JSON.stringify({
        listen_address: "127.0.0.1",
        port: 0,
        data_directory: dir,
        first_admin: { operator_id: "ADM", password_file: join(dir, "pw") },
      }),
    );
    running = await child(cfg);
    const before = await (await fetch(running.url + "/about")).json();
    const headers = {
      "atlas-definitions": protocol.hash,
      "content-type": "application/json",
      "idempotency-key": "login",
    };
    const login = await fetch(running.url + "/administration/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ operator_id: "ADM", password }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    await login.text();
    const key = await (
      await fetch(running.url + "/administration/gateways", {
        method: "POST",
        headers: { ...headers, cookie, "idempotency-key": "provision" },
      })
    ).json();
    const request = async (path: string, body?: unknown, assetKey?: string) => {
      const response = await fetch(running!.url + path, {
        method: "POST",
        headers: {
          ...headers,
          cookie,
          "idempotency-key": crypto.randomUUID(),
          ...(assetKey ? { authorization: `Bearer ${assetKey}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    const assetKey = await request("/administration/asset-keys");
    const description = {
      reports: ["status", "observation"],
      commands: ["hold"],
    };
    const asset = await request("/entities/assets", description, assetKey.key);
    const sent = await request(`/tasks/${asset.asset_id}`, {
      tasks: [{ kind: "hold" }],
    });
    assert.deepEqual(sent.task_ids, [1]);
    await request(
      `/entities/assets/${asset.asset_id}/reports`,
      {
        reports: [
          {
            type: "report.observation",
            kind: "coordinates",
            time: Date.now(),
            asset_id: asset.asset_id,
            observation_id: "OBS",
            position: { latitude: 1, longitude: 2 },
          },
        ],
      },
      assetKey.key,
    );
    const tracksBefore = await (
      await fetch(running.url + "/entities/tracks", {
        headers: { ...headers, cookie },
      })
    ).json();
    assert.equal(tracksBefore.items.length, 1);
    await running.kill("SIGKILL");
    running = await child(cfg);
    assert.equal(
      (await (await fetch(running.url + "/about")).json()).run_id,
      before.run_id,
    );
    assert.equal(
      (
        await fetch(running.url + "/administration/me", {
          headers: { ...headers, cookie },
        })
      ).status,
      200,
    );
    const repeat = await (
      await fetch(running.url + "/administration/gateways", {
        method: "POST",
        headers: { ...headers, cookie, "idempotency-key": "provision" },
      })
    ).json();
    assert.equal(repeat.gateway_id, key.gateway_id);
    assert.equal(repeat.key, undefined);
    const next = await (
      await fetch(running.url + "/administration/gateways", {
        method: "POST",
        headers: { ...headers, cookie, "idempotency-key": "next" },
      })
    ).json();
    assert.notEqual(next.gateway_id, key.gateway_id);
    assert.ok(next.event_id > key.event_id);
    const retained = await (
      await fetch(running.url + `/tasks/${asset.asset_id}`, {
        headers: { ...headers, cookie },
      })
    ).json();
    assert.equal(retained.items[0].state, "sent");
    const nextTask = await request(`/tasks/${asset.asset_id}`, {
      tasks: [{ kind: "hold" }],
    });
    assert.deepEqual(nextTask.task_ids, [2]);
    const restarted = await request(
      "/entities/assets",
      description,
      assetKey.key,
    );
    assert.equal(restarted.asset_id, asset.asset_id);
    assert.equal(restarted.last_task_id, 2);
    const tracksAfter = await (
      await fetch(running.url + "/entities/tracks", {
        headers: { ...headers, cookie },
      })
    ).json();
    assert.equal(tracksAfter.items.length, 1);
    assert.equal(tracksAfter.items[0].track_id, tracksBefore.items[0].track_id);

    const otherKey = await request("/administration/asset-keys");
    const otherAsset = await request(
      "/entities/assets",
      description,
      otherKey.key,
    );
    assert.notEqual(otherAsset.asset_id, asset.asset_id);
  } finally {
    if (running) await running.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

test("14. retries add no event, conflict returns 409; SSE resumes by header [api.md#basics, api.md#the-event-log-and-live-stream]", async () => {
  const h = await startHarness();
  try {
    const first = await h.call("POST", "/administration/gateways", {
      cookie: h.admin,
      idem: "one",
    });
    await h.call("POST", "/administration/gateways", {
      cookie: h.admin,
      idem: "one",
    });
    const second = await h.call("POST", "/administration/plugins", {
      cookie: h.admin,
    });
    assert.equal(second.body.event_id, first.body.event_id + 1);
    const body = { operator_id: "OP1", password, admin: false };
    assert.equal(
      (
        await h.call("POST", "/administration/accounts", {
          cookie: h.admin,
          idem: "account",
          body,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call("POST", "/administration/accounts", {
          cookie: h.admin,
          idem: "account",
          body: { ...body, admin: true },
        })
      ).body.error,
      "idempotency_conflict",
    );
    const controller = new AbortController();
    const stream = await fetch(h.core.url + "/events?after=99999", {
      headers: {
        cookie: h.admin,
        "atlas-definitions": protocol.hash,
        "last-event-id": String(first.body.event_id),
      },
      signal: controller.signal,
    });
    const reader = stream.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.match(text, /event: plugin.provisioned/);
    assert.ok(!text.includes("event: gateway.provisioned"));
    controller.abort();
    await reader.cancel().catch(() => {});
    assert.equal(
      (await h.call("GET", "/entities", { cookie: h.admin })).status,
      200,
    );
  } finally {
    await h.close();
  }
});

test("11. deliberate stop checks ZIP, clears sessions, preserves accounts and global IDs [reset.md#scenarios, runs-and-identity.md#ids]", async () => {
  const h = await startHarness();
  let next: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    assert.equal(
      (
        await h.call("POST", "/administration/accounts", {
          cookie: h.admin,
          body: { operator_id: "OP2", password, admin: false },
        })
      ).status,
      201,
    );
    const gateway = await h.call("POST", "/administration/gateways", {
      cookie: h.admin,
    });
    const assetKey = await h.call("POST", "/administration/asset-keys", {
      cookie: h.admin,
    });
    const description = {
      reports: ["status"],
      commands: ["hold"],
      settings: ["lights"],
    };
    const firstAsset = await h.call("POST", "/entities/assets", {
      key: assetKey.body.key,
      body: description,
    });
    assert.equal(firstAsset.status, 201);
    const stopped = await h.stop();
    assert.equal(stopped.archived, true);
    assert.deepEqual(await checkZip(stopped.zip, h.core.runId), { ok: true });
    const entries = await readZip(stopped.zip);
    for (const name of [
      "manifest.json",
      "summary.md",
      "events.jsonl",
      "state/assets.jsonl",
      "state/tasks.jsonl",
      "state/gateways.jsonl",
      "config.json",
      "versions.json",
    ])
      assert.ok(
        entries.some((entry) => entry.name === name),
        name,
      );
    assert.deepEqual(await readdir(join(h.dataDir, "diagnostics")), []);
    next = await startCore({ clock, config: h.config });
    assert.equal(
      (await (await fetch(next.url + "/about")).json()).run_id,
      h.core.runId + 1,
    );
    const headers = {
      "atlas-definitions": protocol.hash,
      "content-type": "application/json",
    };
    assert.equal(
      (
        await fetch(next.url + "/administration/me", {
          headers: { ...headers, cookie: h.admin },
        })
      ).status,
      401,
    );
    const login = await fetch(next.url + "/administration/login", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "op-login" },
      body: JSON.stringify({ operator_id: "OP2", password }),
    });
    assert.equal(login.status, 200);
    await login.text();
    const adminLogin = await fetch(next.url + "/administration/login", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "admin-login" },
      body: JSON.stringify({ operator_id: "ADM", password }),
    });
    const cookie = adminLogin.headers.get("set-cookie")!.split(";")[0];
    await adminLogin.text();
    const issued = await (
      await fetch(next.url + "/administration/gateways", {
        method: "POST",
        headers: { ...headers, cookie, "idempotency-key": "new-gateway" },
      })
    ).json();
    const newAsset = await fetch(next.url + "/entities/assets", {
      method: "POST",
      headers: {
        ...headers,
        authorization: `Bearer ${assetKey.body.key}`,
        "idempotency-key": "new-asset",
      },
      body: JSON.stringify(description),
    });
    assert.equal(newAsset.status, 201);
    assert.notEqual((await newAsset.json()).asset_id, firstAsset.body.asset_id);
    assert.notEqual(issued.gateway_id, gateway.body.gateway_id);
    assert.ok(issued.event_id > gateway.body.event_id);
    assert.equal(
      (
        await fetch(next.url + "/about", {
          headers: { ...headers, authorization: `Bearer ${gateway.body.key}` },
        })
      ).status,
      200,
    );
  } finally {
    next && (await stopCore(next));
    await h.close();
  }
});

test("12. an unwritable archive clears nothing and next start is new [reset.md#when-the-zip-fails]", async () => {
  const h = await startHarness();
  let next: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    await h.call("POST", "/administration/gateways", { cookie: h.admin });
    await chmod(h.dataDir + "-archive", 0o500);
    const result = await h.stop();
    assert.equal(result.archived, false);
    assert.deepEqual(await readdir(h.dataDir + "-archive"), []);
    assert.ok(
      (await readdir(join(h.dataDir, "diagnostics", `run-${h.core.runId}`)))
        .length > 0,
    );
    await chmod(h.dataDir + "-archive", 0o700);
    next = await startCore({ clock, config: h.config });
    assert.equal(next.runId, h.core.runId + 1);
  } finally {
    await chmod(h.dataDir + "-archive", 0o700);
    next && (await stopCore(next));
    await h.close();
  }
});

test("13. SIGKILL during ZIP resumes run and removes partial [reset.md#scenarios]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-reset-kill-"));
  let running: Awaited<ReturnType<typeof child>> | undefined;
  try {
    const cfg = join(dir, "config.json");
    await writeFile(
      cfg,
      JSON.stringify({
        listen_address: "127.0.0.1",
        port: 0,
        data_directory: dir,
      }),
    );
    running = await child(cfg);
    const run = (await (await fetch(running.url + "/about")).json()).run_id;
    // A real diagnostic file keeps the archive stream open long enough to observe its process boundary.
    const { randomBytes } = await import("node:crypto");
    const { open, watch } = await import("node:fs/promises");
    const log = await open(
      join(dir, "diagnostics", `run-${run}`, "bulk.jsonl"),
      "w",
    );
    try {
      for (let i = 0; i < 64; i++) await log.write(randomBytes(1024 * 1024));
    } finally {
      await log.close();
    }
    const watcher = watch(dir + "-archive", {
      signal: AbortSignal.timeout(15000),
    });
    const exited = once(running.process, "exit");
    running.process.kill("SIGTERM");
    let partial: string | undefined;
    for await (const event of watcher) {
      if (event.filename?.endsWith(".partial")) {
        partial = event.filename;
        if ((await stat(join(dir + "-archive", partial))).size > 0) break;
      }
    }
    assert.ok(partial);
    running.process.kill("SIGKILL");
    assert.equal((await exited)[1], "SIGKILL");
    running = await child(cfg);
    assert.equal(
      (await (await fetch(running.url + "/about")).json()).run_id,
      run,
    );
    assert.deepEqual(await readdir(dir + "-archive"), []);
    assert.equal((await running.kill("SIGTERM"))[0], 0);
    running = undefined;
  } finally {
    if (running) await running.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});

test("13b. final ZIP finishes an interrupted clear; a corrupt ZIP resumes without overwrite [reset.md#when-core-stops-unexpectedly]", async () => {
  for (const corrupt of [false, true]) {
    const h = await startHarness();
    let resumed: Awaited<ReturnType<typeof startCore>> | undefined;
    const snapshot = await mkdtemp(join(tmpdir(), "atlas-reset-snapshot-"));
    try {
      for (const name of ["core.sqlite", "core.sqlite-wal"])
        await copyFile(join(h.dataDir, name), join(snapshot, name));
      const stopped = await h.stop();
      assert.equal(stopped.archived, true);
      const zip = stopped.zip;
      if (corrupt) {
        const { open } = await import("node:fs/promises");
        const file = await open(zip, "r+");
        try {
          await file.write(Buffer.from("broken"), 0, 6, 0);
        } finally {
          await file.close();
        }
        assert.equal((await checkZip(zip)).ok, false);
      }
      const zipBytes = await readFile(zip);
      for (const name of ["core.sqlite", "core.sqlite-wal"])
        await copyFile(join(snapshot, name), join(h.dataDir, name));
      resumed = await startCore({ clock, config: h.config });
      assert.equal(resumed.runId, h.core.runId + (corrupt ? 0 : 1));
      const response = await fetch(resumed.url + "/administration/me", {
        headers: { "atlas-definitions": protocol.hash, cookie: h.admin },
      });
      assert.equal(response.status, corrupt ? 200 : 401);
      await response.text();
      assert.equal((await stopCore(resumed)).archived, !corrupt);
      assert.deepEqual(await readFile(zip), zipBytes);
    } finally {
      resumed && (await stopCore(resumed));
      await h.close();
      await rm(snapshot, { recursive: true, force: true });
    }
  }
});


test("archive stays outside data and diagnostics, including aliases [config.md]", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-archive-path-"));
  try {
    const data = join(root, "data");
    const logs = join(root, "logs");
    await mkdir(logs);
    await symlink(logs, join(root, "alias"));
    for (const archive of [logs, join(logs, "run-1", "archive"), join(root, "alias", "archives"), data]) {
      await assert.rejects(async () => {
        const core = await startCore({ clock, config: { data_directory: data, log_directory: logs, archive_directory: archive, port: 0 } });
        await stopCore(core);
      }, /archive_directory must be outside (data_directory|log_directory)/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("one Core owns a data directory [storage.md]", async () => {
  const h = await startHarness();
  try {
    await assert.rejects(async () => {
      const duplicate = await startCore({ clock, config: h.config });
      await stopCore(duplicate);
    }, /data_directory.*already in use/);
    assert.equal((await h.call("GET", "/administration/me", { cookie: h.admin })).status, 200);
  } finally {
    await h.close();
  }
});


test("Reset shows a late reported outcome beside a dropped Task [reset.md#cores-reset-zip]", async () => {
  const h = await startHarness();
  try {
    const key = await h.call("POST", "/administration/asset-keys", { cookie: h.admin });
    const registered = await h.call("POST", "/entities/assets", { key: key.body.key, body: { reports: ["status"], commands: ["hold"] } });
    const id = registered.body.asset_id;
    assert.equal((await h.call("POST", `/tasks/${id}`, { cookie: h.admin, body: { tasks: [{ kind: "hold" }] } })).status, 202);
    clock.advance(30000);
    assert.equal((await h.call("POST", `/entities/assets/${id}/reports`, { key: key.body.key, body: { reports: [{ type: "report.status", kind: "task", time: clock.now(), asset_id: id, task_id: 1, task_state: "completed" }] } })).status, 200);
    assert.equal((await h.call("GET", `/tasks/${id}`, { cookie: h.admin })).body.items[0].state, "dropped");
    const stopped = await h.stop();
    assert.ok(stopped.archived);
    const summary = (await readZip(stopped.zip)).find((e) => e.name === "summary.md")!;
    const chunks: Buffer[] = [];
    for await (const chunk of summary.open()) chunks.push(chunk);
    assert.match(Buffer.concat(chunks).toString(), /Task 1: dropped; later reported completed/);
  } finally {
    await h.close();
  }
});


test("bootstrap refuses unusable passwords before creating an account [config.md]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-bootstrap-"));
  const pw = join(dir, "pw");
  const config = { data_directory: dir, port: 0, first_admin: { operator_id: "ADM", password_file: pw } };
  try {
    for (const invalid of ["\n", "x".repeat(1025)]) {
      await writeFile(pw, invalid);
      await assert.rejects(async () => {
        const core = await startCore({ clock, config });
        await stopCore(core);
      }, /first_admin.password_file/);
    }
    await writeFile(pw, password);
    const core = await startCore({ clock, config });
    try {
      const login = await fetch(core.url + "/administration/login", { method: "POST", headers: { "content-type": "application/json", "atlas-definitions": protocol.hash, "idempotency-key": "login" }, body: JSON.stringify({ operator_id: "ADM", password }) });
      assert.equal(login.status, 200);
      await login.text();
    } finally { await stopCore(core); }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dir + "-archive", { recursive: true, force: true });
  }
});
