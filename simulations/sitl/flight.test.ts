import { test } from "node:test";
import { flightFixture, type Scenario } from "./fixture.ts";
import { equipmentStartup } from "./equipment-startup.ts";
import { batteryLayers } from "./battery-layers.ts";
import { armedStartup } from "./armed-startup.ts";
import { equipmentDrop } from "./equipment-drop.ts";
import { subsystem } from "./subsystem.ts";
import { requests } from "./requests.ts";
import { crash } from "./crash.ts";
import { failsafeSignal } from "./failsafe-signal.ts";
import { takeover } from "./takeover.ts";
import { landPosition } from "./land-position.ts";
import { idleGap } from "./idle-gap.ts";
import { battery } from "./battery.ts";
import { flight } from "./flight.ts";

const stories = {
  "equipment-startup": equipmentStartup,
  "battery-layers": batteryLayers,
  "armed-startup": armedStartup,
  "equipment-drop": equipmentDrop,
  "equipment-refused": equipmentDrop,
  "equipment-timeout": equipmentDrop,
  subsystem: subsystem,
  requests: requests,
  crash: crash,
  "failsafe-signal": failsafeSignal,
  "rc-late-guided": failsafeSignal,
  takeover: takeover,
  "takeover-response": takeover,
  "land-position": landPosition,
  "atlas-home": landPosition,
  "idle-gap": idleGap,
  battery: battery,
  link: battery,
  boundary: battery,
  flight: flight,
  "land-now": flight,
} satisfies Record<
  Scenario,
  (context: Awaited<ReturnType<typeof flightFixture>>) => Promise<void>
>;

for (const [name, run] of Object.entries(stories))
  test(
    `atlas/first-flight.md and asset/docs/failsafes.md: ${name} on real Core, Asset and SITL`,
    { timeout: 180000 },
    async (t) => {
      await run(await flightFixture(t, name as Scenario));
    },
  );
