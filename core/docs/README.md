# Core docs

**Built.** These pages describe the Core runtime, including all pillars and the Plugin interface.

- [Core API](api.md): requests, reads, the event stream, Asset and gateway calls,
  contact, provisioning, Objects, and Plugins.
- [Architecture](architecture.md): modules and transaction boundaries.
- [Pillars](pillars.md): Entities, Tasks, Objects, Fusion, and Administration, and
  how they share Core's process.
- [Storage](storage.md): the SQLite tables, the event log, and `run_id`.
- [Request admission](requests.md): what Core checks before work reaches an Asset.
- [Fusion](fusion.md): the module inside Core that turns Observations into Tracks.
- [Logging](logging.md): the diagnostic evidence Core keeps and puts in its Reset archive.
- [Reset](reset.md): what stopping Core does, its Reset ZIP, and what it clears. The rules are in [Reset and identity](../../atlas/reset-and-identity.md).
- [Configuration](../config.md): options and defaults.

## Inside Core

Core and Fusion run in one TypeScript process. A Docker container for it is
[planned](../../README.md#stack). Core is
built from [pillars](pillars.md) that keep current state in SQLite tables and an
ordered [event log](api.md#the-event-log-and-live-stream) beside them
([storage](storage.md)). Plugins run in the second ring, connect out to Core with their own keys, and reach
Core through its Plugin interface. See the
[walled city](../../atlas/using-atlas.md#the-walled-city).

Core takes its clock and its data directory from whoever starts it, so
[Simulations](../../simulations/README.md#what-each-part-allows) can run it
unchanged in a simulated world.

[Prototyping findings](../../atlas/archive/prototype-findings.md), now in the
archive, records lessons from earlier experiments. Their runtimes and the
first-flight prototype were removed.
