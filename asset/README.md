# Atlas Asset

Atlas Asset is the configurable software on an Asset. It connects to Atlas,
maintains its own state, reports information, and carries out the work it supports.
A reporting-only Asset needs no equipment-control commands, task queue, or live
settings.

**Planning.** No runtime is built yet. The first Asset to build is a GPS tracker,
followed by an ArduPilot quadcopter. Fixed camera turrets and ADS-B receivers are
also intended Assets. The [first-flight story](../atlas/first-flight.md) describes
the quadcopter's first end-to-end workflow.

- [Behavior](docs/README.md): startup, execution, link loss, and shutdown.
- [Assets and their equipment](docs/assets.md): examples, modules, equipment drivers, and movement profiles.
- [Subsystem conditions](docs/status.md): selective hardware-status reporting.
- [Configuration](config.md): selected requirements and options still under discussion.
- [Logging](docs/logging.md): local diagnostic evidence and Reset archives.
- [Protocol](../protocol/README.md): exact shared data formats.
- [SDK](../sdk/README.md): communication mechanics used by the Asset app.
- AI agents: read [AGENTS.md](AGENTS.md).
