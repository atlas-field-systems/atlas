import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { reportingPeripheral } from "../src/peripheral.ts";
scenario({
  name: "IP current-state reporting waits for change or heartbeat after acknowledgement",
  checks: ["asset/docs/communications.md#report-from-local-state", "sdk/docs/asset.md#report-outbox"],
  async run(w) {
    const { app, send } = await reportingPeripheral(w, { config: { reporting: { heartbeat_s: 5 } } });
    const telemetry = () => w.events.filter(e => e.kind === "report.telemetry");
    const sample = (latitude: number) => send({ kind: "position", source: "GPS", time: w.clock.now(), valid: true, position: { latitude, longitude: 2 } });
    sample(1);
    await w.until(() => telemetry().length === 1);
    await w.advance(1000);
    assert.equal(telemetry().length, 1, "acknowledged state does not spin on IP");
    sample(3);
    await w.until(() => telemetry().length === 2);
    await w.advance(1000);
    assert.equal(telemetry().length, 2, "a changed measurement is sent once");
    const beforeHeartbeat = w.network.traffic.filter(t => t.path.endsWith("/reports")).length;
    await w.advance(app.config.reporting.heartbeat_s * 1000);
    assert.ok(w.network.traffic.filter(t => t.path.endsWith("/reports")).length > beforeHeartbeat, "heartbeat keeps reporting while equipment is quiet");
  },
});
