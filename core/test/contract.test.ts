import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
      401,
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
    await h.core.stop();
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
