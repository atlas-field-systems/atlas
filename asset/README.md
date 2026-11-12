# Atlas Asset

Atlas Asset is the configurable software representing an Asset. It connects to
Core, keeps its own state, reports what it observes, and carries out supported
work. A reporting-only Asset needs no equipment-control commands, task queue, or
live settings.

**Planning.** No runtime exists yet. The first setup runs on a Raspberry Pi on
the ground that acts as the companion computer for an ArduPilot quadcopter over
a SiK radio. The Pi is the gateway, running the
[SiK Fieldlink](../gateway/fieldlinks/sik/README.md), and runs the Asset app for
the vehicle.
The [first-flight story](../atlas/first-flight.md) describes the workflow.

- [Behavior](docs/README.md): startup, work, link loss, and shutdown.
- [Assets and their equipment](docs/assets.md): examples, modules, equipment drivers, and movement profiles.
- [Communications](docs/communications.md): how the Asset reaches Core over IP or a Fieldlink.
- [Command failures and failsafes](docs/failsafes.md): cancellation, configured rules, and operator overrides.
- [Subsystem conditions](docs/status.md): hardware-status reporting.
- [Testing and CI](docs/testing.md): ArduPilot SITL and simulated equipment.
- [Configuration](config.md) and [logging](docs/logging.md): local options and diagnostic evidence.
- [Core API](../core/docs/api.md): how the Asset talks to Core.
- [Protocol](../protocol/README.md): the shared records.
- AI agents: read [AGENTS.md](AGENTS.md).
