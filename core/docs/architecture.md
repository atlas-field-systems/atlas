# Core architecture

[Core's executable](../cmd/atlas-core/) serves HTTP and runs Fusion in one Go
process. It embeds the Protocol definitions and the shared validator. Build and
start it as described in [configuration](../config.md).

## Packages

| Package under `core/` | Owns |
| --- | --- |
| `cmd/atlas-core` | Startup, TLS, signals, shutdown and Reset |
| `internal/api` | HTTP routes, caller authorization, keyed retries, contact deadlines and the event stream |
| `internal/entities`, `internal/tasks`, `internal/objects`, `internal/administration` | The four state-owning [pillars](pillars.md) |
| `internal/fusion` | The Observation follower and the replaceable function that proposes Track changes |
| `internal/store` | The SQLite connection, schema, transaction serialization, run IDs and commit notifications |
| `internal/state` | The current run and transaction, event append and settlement, and diagnostics emitted on commit |
| `internal/protocol` | The embedded validator, package versions and definitions hash |
| `internal/clock`, `internal/config`, `internal/diagnostics` | Time and deadlines, local configuration, and the rotating diagnostic log and loss ledger |
| `internal/reset` | Run export, archive verification and checked clear |

The build packages Protocol's browser entry point and the original definition
bytes. At startup Go loads them into an embedded JavaScript runtime. Core and
the SDK use the same [event kind registry](../src/api/event-kinds.ts). A
mismatch between the registry and the packaged definitions fails startup.

## Transactions and followers

One connection holds the SQLite database open in exclusive mode. A state change,
its events and its retry acknowledgment commit in one transaction. Password
hashing and streamed Object uploads finish before the transaction. Core checks
the caller and retained retry key again when it admits the write.

Event readers subscribe to commit notifications before reading their next page
from disk. Each stream keeps its cursor and one page. Fusion commits Track
changes with the last Observation it processed. Contact deadlines restart on
resume and retain the persisted arrival time as evidence. Before Reset, Core
closes the streams, finishes admitted handlers and drains Fusion.
[Storage](storage.md) describes the tables. [Reset](reset.md) describes the archive.

## Simulation host

The TypeScript module still exposes `startCore({clock, config})`. It starts the
same executable and returns the bound URL, run ID, debug URL and `stop()`.
A private pipe carries clock and lifecycle messages between Core and the
simulation. When a simulated timer fires, the host can wait until Core has
handled it before advancing simulated time. A standalone server uses the
operating system clock.
