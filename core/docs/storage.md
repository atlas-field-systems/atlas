# Core storage

This design for Core storage is selected but not implemented. Record shapes
belong to [Protocol](../../protocol/README.md); this page says where Core puts them.

## Tables hold current state

Core keeps one SQLite database in its `data_directory` ([configuration](../config.md)).
Core reads and changes current state in ordinary tables with plain SQL.

Each table belongs to one [pillar](pillars.md), or is shared by all of them.

| Table | Owner | Holds |
| --- | --- | --- |
| `runs` | Shared | Each run's `run_id`, start, and end |
| `events` | Shared | The [event log](api.md#the-event-log-and-live-stream): `event_id`, `time`, `kind`, `asset_id`, and the record |
| `idempotency_keys` | Shared | Each caller's keys for the run, with a hash of the body and the non-secret response or credential acknowledgment ([retry rules](api.md#callers-and-credentials)) |
| `accounts` | Administration | Admin and operator accounts and their password hashes |
| `gateways` | Administration | Provisioned gateways, their key hashes, and contact |
| `asset_keys` | Administration | Each Asset key's `key_id` and hash |
| `plugins` | Administration | Provisioned Plugins: ID, key hash, latest description, and contact |
| `objects` | Objects | Each Object record that is not deleted. The files sit in the `data_directory` beside the database |
| `assets` | Entities | Each Asset registered in the run: `asset_id`, the Asset key or gateway that registered it, the gateway carrying a radio Asset, latest description, and contact. A removed Asset keeps its row, marked removed and not listed |
| `tasks` | Tasks | Each Task's body, `requested_by`, and latest state |
| `queues` | Tasks | Each Asset's latest reported queue and `clear_count` ([operator requests](api.md#operator-requests)) |
| `tracks` | Entities | Each current Track, as Fusion last wrote it ([Tracks](api.md#tracks)) |
| `geofeatures` | Entities | Each current geo feature ([Geo features](api.md#geo-features)) |

Observations have no table. They are Asset reports, so each Observation is an
indexed query for the latest `report.observation` of its `asset_id` and
`observation_id`, as below.

## Every change writes one event

A change updates its tables and appends its event in the same transaction. The
event stream therefore never shows a change that was not stored, and every stored
change appears in it. Core never rebuilds tables from events.

Asset reports, Plugin calls, and Plugin answers are stored only as events.
History, the latest report of each kind, each setting's latest value, and each
subsystem's latest condition are indexed queries on `events`, so no report is
kept twice.

## Runs

A run is the span between two Resets. Every row in `assets`, `tasks`, `queues`, `tracks`,
`geofeatures`, `objects`, `idempotency_keys`, and `events` carries its `run_id`,
and each Object's file is kept with its run. Rules scoped to a run, such as
unique `asset_id`s, `task_id`s, `track_id`s, `geofeature_id`s, and idempotency keys, hold
within one `run_id`. Rows from earlier runs stay readable as history until
retention removes them. The Reset request, its archive, and what it clears are
[not defined yet](api.md#not-defined-yet).

## Memory and retention

- Core holds no backlog in memory. Event streams and history pages read from disk.
- Core removes a run's rows once the run is older than `run_retention_days`
  ([Scale](../../atlas/scale.md#runs-and-storage)). The current run is never removed.
- Core builds archives and removes old runs only at Reset, so neither slows a
  run in progress.
