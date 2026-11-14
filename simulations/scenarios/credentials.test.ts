import { bytesUnder } from "../src/stored.ts";
import { join } from "node:path";
import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
scenario({
  name: "credential retries return acknowledgments and login recovers its cookie",
  checks: ["core/docs/api.md#credential-retry-scenarios"],
  async run(w) {
    w.network.once("admin", "/administration/asset-keys", {
      kind: "loseResponse",
    });
    const issued = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok(!("key" in issued) && "issued" in issued);
    const params = { key_id: issued.key_id };
    const replacement = value(
      await w.complete(w.admin.call("replaceAssetKey", { params })),
    );
    assert.ok("key" in replacement);
    if (!("key" in replacement)) throw new Error("No replacement key");
    const old = w.client("old", { kind: "asset", key: replacement.key });
    value(await w.complete(old.connect()));
    w.network.once("admin", `/administration/asset-keys/${issued.key_id}/key`, {
      kind: "loseResponse",
    });
    const lost = value(
      await w.complete(w.admin.call("replaceAssetKey", { params })),
    );
    assert.ok("replaced" in lost && !("key" in lost));
    const rejected = await w.complete(old.connect());
    assert.ok(
      !rejected.ok && rejected.status === 401,
      "lost replacement rotates once and invalidates old key",
    );
    const recovered = value(
      await w.complete(w.admin.call("replaceAssetKey", { params })),
    );
    assert.ok("key" in recovered);
    for (const [route, name, field] of [
      ["provisionGateway", "gateways", "gateway_id"],
      ["provisionPlugin", "plugins", "plugin_id"],
    ] as const) {
      w.network.once("admin", `/administration/${name}`, {
        kind: "loseResponse",
      });
      const result = value(await w.complete(w.admin.call(route)));
      assert.ok("issued" in result && !("key" in result) && field in result);
      if ("gateway_id" in result) {
        const params = { gateway_id: result.gateway_id };
        const first = value(
          await w.complete(w.admin.call("replaceGatewayKey", { params })),
        );
        if (!("key" in first)) throw new Error("No gateway key");
        const old = w.client("old-gateway", {
          kind: "gateway",
          key: first.key,
        });
        value(await w.complete(old.connect()));
        w.network.once(
          "admin",
          `/administration/gateways/${result.gateway_id}/key`,
          { kind: "loseResponse" },
        );
        const ack = value(
          await w.complete(w.admin.call("replaceGatewayKey", { params })),
        );
        assert.ok("replaced" in ack && !("key" in ack));
        const rejected = await w.complete(old.connect());
        assert.ok(!rejected.ok && rejected.status === 401);
        assert.ok(
          "key" in
            value(
              await w.complete(w.admin.call("replaceGatewayKey", { params })),
            ),
        );
      } else if ("plugin_id" in result) {
        const params = { plugin_id: result.plugin_id };
        const first = value(
          await w.complete(w.admin.call("replacePluginKey", { params })),
        );
        if (!("key" in first)) throw new Error("No Plugin key");
        const old = w.client("old-plugin", {
          kind: "plugin",
          key: first.key,
          plugin_id: result.plugin_id,
        });
        value(await w.complete(old.connect()));
        w.network.once(
          "admin",
          `/administration/plugins/${result.plugin_id}/key`,
          { kind: "loseResponse" },
        );
        const ack = value(
          await w.complete(w.admin.call("replacePluginKey", { params })),
        );
        assert.ok("replaced" in ack && !("key" in ack));
        const rejected = await w.complete(old.connect());
        assert.ok(!rejected.ok && rejected.status === 401);
        assert.ok(
          "key" in
            value(
              await w.complete(w.admin.call("replacePluginKey", { params })),
            ),
        );
      }
    }
    const account = w.client("login", { kind: "account" });
    value(await w.complete(account.connect()));
    const failed = await w.complete(account.login("ADM", "wrong-password"));
    assert.ok(!failed.ok && failed.status === 401);
    assert.equal(
      account.status.phase,
      "connected",
      "failed login does not latch unauthenticated",
    );
    w.network.once("login", "/administration/login", { kind: "loseResponse" });
    value(await w.complete(account.login("ADM", "simulation-password")));
    assert.equal(
      value(await w.complete(account.call("me"))).operator_id,
      "ADM",
    );
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "login" && t.path === "/administration/login",
      ).length,
      4,
      "failed login, lost answer, same-key acknowledgment, then fresh cookie login",
    );
    w.network.once("login", "/administration/login", { kind: "loseResponse" });
    value(await w.complete(account.login("ADM", "simulation-password")));
    assert.equal(
      value(await w.complete(account.call("me"))).operator_id,
      "ADM",
      "an existing delivered cookie remains usable after an acknowledgment-only replay",
    );
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "login" && t.path === "/administration/login",
      ).length,
      6,
      "existing cookie avoids a fresh login after replay",
    );
    value(await w.complete(account.call("logout")));
    const loggedOut = await w.complete(account.call("me"));
    assert.ok(!loggedOut.ok && loggedOut.status === 401);
    await w.restartCore();
    const stored = (
      await Promise.all(
        ["data", "archive", "logs"].map((dir) => bytesUnder(join(w.root, dir))),
      )
    ).flat();
    assert.ok(stored.length > 0);
    for (const secret of [...w.network.secrets, "simulation-password"])
      for (const bytes of stored)
        assert.ok(
          !new TextDecoder().decode(bytes).includes(secret),
          "stored credentials cannot be recovered",
        );
  },
});

scenario({
  name: "credential body conflicts and failed login retries create no session",
  checks: ["core/docs/api.md#credential-retry-scenarios"],
  async run(w) {
    value(
      await w.complete(
        w.admin.call("addAccount", {
          body: {
            operator_id: "OP",
            password: "second-password",
            admin: false,
          },
        }),
      ),
    );
    const fetch = w.network.fetchFor("conflict-login");
    const client = w.client(
      "conflict-login",
      { kind: "account" },
      (input, init) => {
        const headers = new Headers(init?.headers);
        if (String(input).endsWith("/administration/login"))
          headers.set("Idempotency-Key", "same-login-attempt");
        return fetch(input, { ...init, headers });
      },
    );
    value(await w.complete(client.connect()));
    const failed = await w.complete(client.login("ADM", "wrong-password"));
    assert.ok(!failed.ok && failed.status === 401);
    const failedAgain = await w.complete(client.login("ADM", "wrong-password"));
    assert.ok(!failedAgain.ok && failedAgain.status === 401);
    const absent = await w.complete(client.call("me"));
    assert.ok(!absent.ok && absent.status === 401);
    value(await w.complete(client.login("ADM", "simulation-password")));
    const conflict = await w.complete(client.login("OP", "second-password"));
    assert.ok(
      !conflict.ok &&
        conflict.status === 409 &&
        conflict.error === "idempotency_conflict",
    );
    assert.equal(
      value(await w.complete(client.call("me"))).operator_id,
      "ADM",
      "conflict preserves original session",
    );
  },
});
