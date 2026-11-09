# Core storage

How Core keeps its data. Selected design, not implemented. Record shapes belong to
[Protocol](../../protocol/README.md); this page says where Core puts them.

## Tables hold current state

Core keeps one SQLite database in its `data_directory` ([configuration](../config.md)).
Current state lives in ordinary tables, read and changed with plain SQL.

| Table | Holds |
| --- | --- |
| `runs` | Each run's `run_id`, start, and end |
| `accounts` | Admin and operator accounts and their password hashes |
| `assets` | Provisioned Assets: ID, type, key hash, latest description, and contact |
| `gateways` | Provisioned gateways and their key hashes |
| `tasks` | Each Task's body, `requested_by`, and latest state |
| `queues` | Each Asset's latest reported list and `queue_version`, the list in flight, and the Tasks waiting ([one list in flight](api.md#operator-requests)) |
| `idempotency_keys` | Each caller's keys for the run, with a hash of the body and the response |
| `events` | The [event log](api.md#the-event-log-and-live-stream): `event_id`, `time`, `kind`, `asset_id`, and the record |

## Every change writes one event

A change updates its tables and appends its event in the same transaction. The
event stream therefore never shows a change that was not stored, and every stored
change appears in it. Core never rebuilds tables from events.

Asset reports are stored only as events. History, the latest report of each kind,
and each setting's latest value are indexed queries on `events`, so no report is
kept twice.

## Runs

A run is the span between two Resets. Every row in `tasks`, `queues`,
`idempotency_keys`, and `events` carries its `run_id`. Rules scoped to a run, such
as unique `task_id`s and idempotency keys, hold within one `run_id`. Rows from
earlier runs stay readable as history until retention removes them. The Reset
request, its archive, and what it clears are
[not defined yet](api.md#not-defined-yet).

## Memory and retention

- Core holds no backlog in memory. Event streams and history pages read from disk.
- Core removes a run's rows once the run is older than `run_retention_days`
  ([Scale](../../atlas/scale.md#runs-and-storage)). The current run is never removed.
