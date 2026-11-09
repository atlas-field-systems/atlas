# Core docs

Selected behavior for the Core runtime. None of it is implemented yet.

- [Core API](api.md): requests, reads, the event stream, Asset and gateway calls,
  contact, and provisioning.
- [Pillars](pillars.md): Entities, Tasks, Objects, Fusion, and Administration, and
  how they share Core's process.
- [Storage](storage.md): the SQLite tables, the event log, and runs.
- [Request admission](requests.md): what Core checks before work reaches an Asset.
- [Fusion](fusion.md): the module inside Core that turns Observations into Tracks.
- [Logging](logging.md): the diagnostic evidence Core keeps and puts in its Reset archive.
- [Configuration](../config.md): proposed options.

## Inside Core

Core and Fusion run in one TypeScript process in one Docker container. Core is
built from [pillars](pillars.md) that keep current state in SQLite tables and an
ordered [event log](api.md#the-event-log-and-live-stream) beside them
([storage](storage.md)). Plugins run in the second ring, each in its own
container if it needs one, and reach Core through its Plugin interface. See the
[walled city](../../atlas/design-decisions.md#a-walled-city).

[Prototyping findings](experiments/final-report.md) records lessons from earlier
experiments. Their runtimes and the first-flight prototype were removed.
