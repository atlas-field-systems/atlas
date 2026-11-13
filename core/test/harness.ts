import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startCore } from "../src/core.ts";
import type { Clock } from "../src/clock.ts";
import { loadPackagedProtocol } from "@atlas/protocol";

export const clock: Clock = {
  now: () => 1794560400000,
  after() {
    return { cancel() {} };
  },
};
export const protocol = await loadPackagedProtocol();
export const password = "contract-password-unique";
export async function startHarness(
  testClock: Clock = clock,
  overrides: Partial<import("../src/config.ts").CoreConfig> = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "atlas-core-"));
  const pw = join(dataDir, "first-password");
  await writeFile(pw, password);
  const config = {
    data_directory: dataDir,
    listen_address: "127.0.0.1",
    port: 0,
    first_admin: { operator_id: "ADM", password_file: pw },
    ...overrides,
  };
  const core = await startCore({ clock: testClock, config });
  async function call(
    method: string,
    path: string,
    opts: { cookie?: string; key?: string; idem?: string; body?: unknown } = {},
  ) {
    const headers: Record<string, string> = {
      "Atlas-Definitions": protocol.hash,
      "Idempotency-Key": opts.idem ?? randomUUID(),
      "content-type": "application/json",
    };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.key) headers.authorization = `Bearer ${opts.key}`;
    const response = await fetch(core.url + path, {
      method,
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  const login = await call("POST", "/administration/login", {
    body: { operator_id: "ADM", password },
  });
  const admin = login.headers.get("set-cookie")!.split(";")[0];
  return {
    core,
    config,
    dataDir,
    call,
    admin,
    async close() {
      await core.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
