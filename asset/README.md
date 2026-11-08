# Atlas Asset

Atlas Asset is the configurable software representing an Asset. It connects to
Atlas, maintains its own state, reports information, and carries out supported work.
A reporting-only Asset needs no equipment-control commands, task queue, or live
settings.

**Planning.** No runtime is built yet. The first setup runs on a ground-based
Raspberry Pi connected to Core over Wi-Fi and to an ArduPilot quadcopter over
a SiK radio. The Pi acts as the companion computer. A GPS tracker, fixed camera
turrets, and ADS-B receivers remain intended Assets. The
[first-flight story](../atlas/first-flight.md) describes the initial
quadcopter workflow.

- [Behavior](docs/README.md): startup, execution, link loss, and shutdown.
- [Assets and their equipment](docs/assets.md): examples, modules, equipment drivers, and movement profiles.
- [Subsystem conditions](docs/status.md): selective hardware-status reporting.
- [Communications](docs/communications.md): local state reporting and goals for multiple links and mesh paths.
- [Testing and CI](docs/testing.md): hardware-free scenarios, tests, and evals.
- [Configuration](config.md): selected requirements and options still under discussion.
- [Logging](docs/logging.md): local diagnostic evidence and Reset archives.
- [Protocol](../protocol/README.md): exact shared data formats.
- [SDK](../sdk/README.md): communication mechanics used by the Asset app.
- AI agents: read [AGENTS.md](AGENTS.md).
