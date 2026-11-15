# Atlas Asset

Atlas Asset is the configurable software representing an Asset. It connects to
Core, keeps its own state, reports what it observes, and carries out supported
work. A reporting-only Asset needs no equipment-control commands, task queue, or
live settings.

**Runtime in progress.** The initial IP path runs against ArduPilot SITL.
The documented behavior remains the target; this implementation is incomplete. The first setup runs on a Raspberry Pi on
the ground that acts as the companion computer for an ArduPilot quadcopter over
a SiK radio. The Pi is the gateway, running the
[SiK Fieldlink](../fieldlink/sik/README.md), and runs the Asset app for
the vehicle.
The [first-flight story](../atlas/first-flight.md) describes the workflow.

- [Behavior](docs/README.md): startup, work, link loss, and shutdown.
- [Assets and their equipment](docs/assets.md): examples, modules, equipment drivers, and movement profiles.
- [Communications](docs/communications.md): how the Asset reaches Core over IP or a Fieldlink.
- [Command failures and failsafes](docs/failsafes.md): cancellation, configured rules, and operator overrides.
- [Subsystem conditions](docs/status.md): hardware-status reporting.
- [Asset simulations](../simulations/docs/asset.md): ArduPilot SITL and simulated equipment, in [Simulations](../simulations/README.md).
- [Configuration](config.md) and [logging](docs/logging.md): local options and diagnostic evidence.
- [Core API](../core/docs/api.md): how the Asset talks to Core.
- [Protocol](../protocol/README.md): the shared records.
- AI agents: read [AGENTS.md](AGENTS.md).

## Run the initial app

Use Node 24. Run `npm ci` in Protocol, Core, the SDK, and Asset, in that order.
From `asset/`, inspect a configuration with
`node src/main.ts inspect examples/copter.json`, then start it with
`node src/main.ts run <config.json>`. Provision its key in Core first.
The copter equipment connection is MAVLink 2 over TCP. A radio connection
requires an external serial-to-TCP transport and has not been checked.

The initial runtime executes Takeoff, Move To, Guided Hold, pause/resume, and
Land where it is. Equipment commands supersede earlier operations and report
their own acknowledgements or refusals. It evaluates
battery, airborne, idle, and contact-loss conditions locally. The SDK supplies
ordering and report retries. A configured stationary equipment driver supplies
one position. The [SITL scenarios](../simulations/docs/asset.md#run-the-initial-sitl-scenarios)
check Hold followed by Move To, pause/resume, Land now during Move To,
low battery, and loss of the Core path. They check Core reports and archived
measurements; they do not establish full conformance.

## Implementation gaps

This draft is not ready for a field operation. These are implementation gaps,
not changes to the behavior specified in the linked pages:

- The control state now separates phase, execution, override, and per-rule
  matching state. Commanded activation overrides pause, repeated settings do not
  reissue movement, and suspended time does not consume the command timeout.
  Critical fallback retains its rule and priority. Boundary and subsystem
  condition durations, request correlation for Task overrides, and identifying
  idle from startable work rather than every held Task remain incomplete.
- The command registry still duplicates command kinds and uses shared
  completion tolerances. Current-state offers, duplicate active Task reports,
  flight-controller request refusal, blocked outbox/session diagnostics,
  vehicle ticks, and log sealing still need completion.
- Boundary and subsystem failsafe conditions, complete rule re-arming, priority and fallback cases, and all override answers
  need implementation or simulation coverage.
- Land at a position and transit altitudes are not executed. Return to home
  currently uses ArduPilot's home, rather than resolving the Atlas setting.
- Queue cancellation and updates during failsafe, place updates while paused, and live policy validation need completion.
- The driver does not yet recover an equipment TCP connection. Position is
  gated on GPS fix and EKF position validity. Refusal and timeout coverage
  still needs the full equipment-failure scenario matrix.
- The reporting-only path does not yet support empty settings, continuing
  stationary measurements, GPS peripherals, detector Observations, or files.
- Startup failure cleanup, local protection before Core joins, service
  installation, and flight-controller takeover need more work and scenarios.
- [Logging gaps](docs/logging.md#implementation-status) remain.
