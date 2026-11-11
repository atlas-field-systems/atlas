# Atlas Core

Atlas Core is the server inside the inner wall. It keeps the shared picture and
the event log, serves the [Core API](docs/api.md), and runs Fusion. Shared record
formats come from [Protocol](../protocol/README.md).

**Planning.** No runtime is built yet. The earlier first-flight prototype was
removed. Git history retains it.

- [Core API](docs/api.md): how the Command Interface, Assets, and gateways talk to Core.
- [Request admission](docs/requests.md): Core's checks before work reaches an Asset.
- [Fusion](docs/fusion.md): turning Observations into Tracks.
- [Logging](docs/logging.md) and [configuration](config.md): diagnostic evidence and options.
- [Prototyping findings](../atlas/archive/prototype-findings.md): historical lessons from earlier experiments.
- Charter: https://atlas-field-systems.github.io/atlas/
- AI agents: read [AGENTS.md](AGENTS.md).
