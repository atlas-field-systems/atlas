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
    const rejected = await w.complete(old.call("about"));
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
    value(await w.complete(account.call("logout")));
    const loggedOut = await w.complete(account.call("me"));
    assert.ok(!loggedOut.ok && loggedOut.status === 401);
  },
});
