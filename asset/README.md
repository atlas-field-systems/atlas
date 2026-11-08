# Atlas Asset

Atlas Asset is the software on an Asset, such as a drone or position beacon.
It connects to Core, reports information, and carries out supported work.
A beacon reports its position without accepting equipment-control commands.

**Planning.** No code yet. This folder will say how an Asset behaves from start-up to shutdown, so Core can rely on that behavior instead of guarding against an Asset that misbehaves.

- Charter: https://atlas-field-systems.github.io/atlas/
- Protocol (all data formats, and how parts talk over a link): https://github.com/atlas-field-systems/atlas/tree/main/protocol
- Docs: [docs/README.md](docs/README.md)
- Asset kinds and equipment: [model](docs/assets.md)
- Configuration options for discussion: [config.md](config.md)
- Diagnostic evidence and Reset archive: [logging](docs/logging.md)
- AI agents: read [AGENTS.md](AGENTS.md).
