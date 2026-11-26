# Core storage

**Built.** Core stores current state and events in SQLite. Record shapes
belong to [Protocol](../../protocol/README.md); this page says where Core puts them.

## Tables hold current state

The `runs` row holds the last geo feature and Object sequence numbers.
Deleting a current row never makes its ID available again before the next Reset.
The `queues` table is a deliberate copy of the latest eligible queue report,
written in the report's transaction.

Core keeps one SQLite database in its `data_directory` ([configuration](../config.md)).
Core reads and changes current state in ordinary tables with plain SQL.

Each table belongs to one [pillar](pillars.md), or is shared by all of them.

| Table | Owner | Holds |
| --- | --- | --- |
| `runs` | Shared | Each `run_id`, when Core started and stopped with it, and each unexpected stop Core resumed from. Rows stay after a Reset clears the picture, so `run_id` is never reused |
| `asset_ids` | Shared | The last `asset_id` Core assigned. It stays after a Reset, so no Asset ID is ever reused ([Reset and identity](../../atlas/reset-and-identity.md#ids)) |
| `events` | Shared | The [event log](api.md#the-event-log-and-live-stream): `event_id`, `time`, `kind`, `asset_id`, and the record |
| `idempotency_keys` | Shared | Each caller's keys since the last Reset, with a hash of the body and the non-secret response or credential acknowledgment ([retry rules](api.md#callers-and-credentials)) |
| `accounts` | Administration | Admin and operator accounts and their password hashes |
| `sessions` | Administration | Each session's token hash and account, until the next Reset |
| `gateways` | Administration | Provisioned gateways, their key hashes, and contact; removed rows remain until the next Reset |
| `asset_keys` | Administration | Each Asset key's `key_id` and hash |
| `plugins` | Administration | Provisioned Plugins: ID, key hash, latest description, and contact; removed rows remain until the next Reset |
| `objects` | Objects | Each Object record, a deleted one marked deleted. The files sit in the `data_directory` beside the database, deleted ones included |
| `assets` | Entities | Each Asset registered since the last Reset: `asset_id`, the Asset key or gateway that registered it, the gateway carrying a radio Asset, latest description, and contact. A removed Asset keeps its row, marked removed and not listed |
| `tasks` | Tasks | Each Task's body, `requested_by`, and latest state |
| `queues` | Tasks | Each Asset's latest reported queue ([operator requests](api.md#operator-requests)) |
| `geofeatures` | Entities | Each current geo feature ([Geo features](api.md#geo-features)) |

Observations have no table. They are Asset reports, so each Observation is an
indexed query for the latest `report.observation` of its `asset_id` and
`observation_id`, as below.

## Every change writes one event

A change updates its tables and appends its event in the same transaction. The
event stream therefore never shows a change that was not stored, and every stored
domain change appears in it. Credential and account changes use diagnostics only. Core never rebuilds tables from events.

Asset reports, Plugin calls, and Plugin answers are stored only as events.
History, the latest report of each kind, each setting's latest value, and each
subsystem's latest condition are indexed queries on `events`, so no report is
kept twice, except the queue copy described above.

## Reset and `run_id`

`run_id` is the built name of the counter that changes at each
[Reset](reset.md). A start after a stop adds a row to `runs` with the next
`run_id`, a rising integer never reused. A start after a crash finds a `run_id`
with no end and [keeps the picture](reset.md#when-core-stops-unexpectedly)
instead. Every row in `assets`, `tasks`, `queues`, `geofeatures`,
`objects`, `sessions`, `idempotency_keys`, and `events` carries its `run_id`,
and each Object's file is kept under it. Rules that hold until the next Reset,
such as unique `asset_id`s, `task_id`s, `geofeature_id`s, and
idempotency keys, hold within one `run_id`. `event_id` keeps rising across
Resets and is never reused.

At Reset, Core writes its Reset ZIP, checks it, and then deletes the rows and
files under that `run_id`. Accounts and keys carry no `run_id` and stay
([what carries over](../../atlas/reset-and-identity.md#what-carries-over)).
Normally the database holds only the current picture. Older data stays only if
its ZIP failed, until the admin handles it by hand.
[Reset](reset.md) owns the procedure.

## Memory and full disks

- Core holds no backlog in memory. Event streams and history pages read from disk.
- Core builds archives and clears the picture only at Reset, so neither slows
  Core while it serves. Core never deletes a Reset ZIP.
- If a change cannot be written, because the disk is full or the database
  fails, Core refuses the request with `507 storage_full` and stores nothing.
  Nothing is accepted without its event.

Diagnostic loss counts are durable metadata, kept until the next Reset, in `data_directory/diagnostic-gaps/`.
Core coalesces loss counts into one asynchronous, atomic ledger writer, separately
from the capped diagnostic files. Debug reads and Reset wait for that writer.
A crash may lose counts still being written; the unexpected stop itself is always
listed as a gap. Reset includes the counts in its manifest and
summary and removes the ledger only after checking the ZIP.

Entities keeps each Asset's actual last arrival in `asset_heard`, including empty
report batches. Contact deadlines restart at resume independently of this evidence;
Reset uses the stored arrival rather than the later offline transition.

Administration keeps gateway and Plugin arrivals in `identity_heard` rows kept until the next Reset.
Resumed offline records retain those arrival times while their deadlines restart.

Only one Core may open a `data_directory` at a time; a second startup refuses
before recovery or upload cleanup can change the stored picture.
