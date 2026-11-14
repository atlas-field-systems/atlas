# Core architecture

`startCore({clock, config})` is the module interface. It returns the bound URL,
run ID, debug URL, and `stop`. Outside programs use HTTP.

## Modules

| Module | Owns |
| --- | --- |
| `main.ts`, `core.ts` | Configuration, boot order, composition, signals |
| `clock.ts`, `config.ts`, `ids.ts`, `log.ts` | Injected time, local configuration, short ID encoding, diagnostics |
| `store/db.ts` | SQLite connection, synchronous transactions, commit notifications |
| `api/event-kinds.ts` | Public event kind-to-record data |
| `store/events.ts` | Event audience and request rules, append validation, settlement, filtering, pages |
| `store/idempotency.ts`, `store/runs.ts` | Retry responses, recovery, counters |
| `api/routes.ts`, `server.ts`, `auth.ts`, `errors.ts`, `stream.ts` | Route table, pipeline, authorization, refusals, SSE |
| `pillars/` | Entities, Tasks, Objects, Administration, Fusion |
| `contact.ts`, `plugins.ts`, `reset/` | Contact deadlines, Plugin interface, archives |

## Decisions that shape the code

SQLite uses WAL, `synchronous=FULL`, and foreign keys. One synchronous transaction
per change keeps admission and effects indivisible. The callback type rejects
Promises. Slow work such as password hashing happens before the transaction.
Routes may prepare with the Store to read credential hashes before scrypt.

`api/event-kinds.ts` owns each kind's Protocol record and array flag.
`store/events.ts` adds audience and request rules.
Append validates records with Protocol. Each request kind names its recipient and answering event kinds; settlement
requires both to match as well as `request_id`. There is no second requests table.
Streams read pages from disk and keep only a cursor, never a backlog.

Global short IDs use a persistent sequence that skips account IDs. Per-run
counters survive deletion. Fusion is a pure function plus an event follower,
with its cursor committed alongside Track changes. Contact deadlines use the
injected clock; persistent consequences belong to the offline transaction.

## Schema ownership

Each pillar exports its table definitions and owns its SQL. Shared storage
owns runs, counters, events, and retry keys. [Storage](storage.md) lists the
tables and [pillars](pillars.md#rules) defines access across owners.

All pillars and the Plugin interface are implemented.
[Reset](reset.md) writes and checks the archive before clearing the run.
Contact stops and Fusion drains before Reset exports state.
