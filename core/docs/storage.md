# Core storage

This design for Core storage is selected but not implemented. Record shapes
belong to [Protocol](../../protocol/README.md); this page says where Core puts them.

## Tables hold current state

Core keeps one SQLite database in its `data_directory` ([configuration](../config.md)).
Core reads and changes current state in ordinary tables with plain SQL.

Each table belongs to one [pillar](pillars.md), or is shared by all of them.

| Table | Owner | Holds |
| --- | --- | --- |
| `runs` | Shared | Each run's `run_id`, start, end, and each unexpected stop Core resumed from. Rows stay after the run is cleared, so `run_id` is never reused |
| `asset_ids` | Shared | The last `asset_id` Core assigned. It stays after the run is cleared, so no Asset ID is reused in a later run ([Runs and identity](../../atlas/runs-and-identity.md#ids)) |
| `events` | Shared | The [event log](api.md#the-event-log-and-live-stream): `event_id`, `time`, `kind`, `asset_id`, and the record |
| `idempotency_keys` | Shared | Each caller's keys for the run, with a hash of the body and the non-secret response or credential acknowledgment ([retry rules](api.md#callers-and-credentials)) |
| `accounts` | Administration | Admin and operator accounts and their password hashes |
| `sessions` | Administration | Each session's token hash and account, for the run |
| `gateways` | Administration | Provisioned gateways, their key hashes, and contact |
| `asset_keys` | Administration | Each Asset key's `key_id` and hash |
| `plugins` | Administration | Provisioned Plugins: ID, key hash, latest description, and contact |
| `objects` | Objects | Each Object record, a deleted one marked deleted. The files sit in the `data_directory` beside the database, deleted ones included |
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

A run is the span from one start of Core to the next deliberate stop
([Reset](reset.md)). A start after a stop adds a row to `runs` with the next
`run_id`, a rising integer never reused. A start after a crash finds a run with
no end and [resumes it](reset.md#when-core-stops-unexpectedly) instead. Every
row in `assets`, `tasks`, `queues`, `tracks`, `geofeatures`, `objects`,
`sessions`, `idempotency_keys`, and `events` carries its `run_id`,
and each Object's file is kept with its run. Rules scoped to a run, such as
unique `asset_id`s, `task_id`s, `track_id`s, `geofeature_id`s, and idempotency keys, hold
within one `run_id`. `event_id` keeps rising across runs and is never reused.

When a run ends, Core writes its Reset ZIP, checks it, and then deletes the
run's rows and files. Accounts and keys belong to no run and stay
([what carries over](../../atlas/runs-and-identity.md#what-carries-over)).
Normally the database holds only the current run. An earlier run stays only
while its ZIP has not been written; Core retries it at each start and never
serves it through the Core API.
[Reset](reset.md) owns the procedure.

## Memory and full disks

- Core holds no backlog in memory. Event streams and history pages read from disk.
- Core builds archives and clears runs only when a run ends, so neither slows a
  run in progress. Core never deletes a Reset ZIP.
- If a change cannot be written, because the disk is full or the database
  fails, Core refuses the request with `507 storage_full` and stores nothing.
  Nothing is accepted without its event.
