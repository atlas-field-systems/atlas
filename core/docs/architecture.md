# Core architecture

`startCore({clock, config})` is the module interface. It returns the bound URL,
run ID, debug URL, and `stop`. Outside programs use HTTP.

## Modules

| Module | Owns |
| --- | --- |
| `main.ts`, `core.ts` | Configuration, boot order, composition, signals |
| `clock.ts`, `config.ts`, `ids.ts`, `log.ts` | Injected time, local configuration, short ID encoding, diagnostics |
| `store/db.ts` | SQLite connection, synchronous transactions, commit notifications |
| `store/events.ts` | Event kinds, append validation, settlement, audience filtering, pages |
| `store/idempotency.ts`, `store/runs.ts` | Retry responses, recovery, counters |
| `api/routes.ts`, `server.ts`, `auth.ts`, `errors.ts`, `stream.ts` | Route table, pipeline, authorization, refusals, SSE |
| `pillars/` | Entities, Tasks, Objects, Administration, Fusion |
| `contact.ts`, `plugins.ts`, `reset/` | Contact deadlines, Plugin interface, archives |

## Decisions that shape the code

SQLite uses WAL, `synchronous=FULL`, and foreign keys. One synchronous transaction
per change keeps admission and effects indivisible. The callback type rejects
Promises. Slow work such as password hashing happens before the transaction.
Routes may prepare with the Store to read credential hashes before scrypt.

`EVENT_KINDS` defines each kind's Protocol record, audience, and request status.
Append validates records with Protocol. Settlement is an indexed lookup for an
event whose `request_id` names the request. There is no second requests table.
Streams read pages from disk and keep only a cursor, never a backlog.

Global short IDs use a persistent sequence that skips account IDs. Per-run
counters survive deletion. Fusion is a pure function plus an event follower,
with its cursor committed alongside Track changes. Contact deadlines use the
injected clock; persistent consequences belong to the offline transaction.

## Schema ownership

Each pillar exports its table definitions and owns its SQL. Shared storage
owns runs, counters, events, and retry keys. [Storage](storage.md) lists the
tables and [pillars](pillars.md#rules) defines access across owners.

Administration and shared storage are implemented. Other pillar bodies remain
explicit stubs and their routes return `501 not_implemented`.
[Reset](reset.md) writes and checks the archive before clearing the run.
Contact and Fusion shutdown callbacks still need their runtime implementations.
