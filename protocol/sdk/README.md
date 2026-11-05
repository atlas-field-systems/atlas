# Atlas SDK

The one implementation every program uses: Core, gateways, operator apps and Assets on IP. It builds, validates and parses messages, and handles keys, queueing and retry, and duplicates. It loads the definitions in [`definitions/`](../definitions) rather than defining its own, so a change to the spec and its implementation land in one PR.

Transport adapters (WebSocket, Meshtastic, FLRC) only move bytes. Each will be its own package beside the SDK, so a program installs only the links it uses.

**Nothing is built yet.** These are the concepts the SDK keeps, for review.

## Concepts the SDK keeps

1. **One front door.** Every program (Core, bridges, operator apps, Assets on IP) uses the SDK. Core still checks every message itself; the SDK does not replace that.
2. **Typed values, not raw JSON.** Callers build and read messages through helpers. Fields, precision and left-out fields are kept exactly.
3. **Check at the edges.** Messages are checked against Protocol's definitions on the way in and on the way out. Commands and every other message come from the definitions, never hardcoded.
4. **Two ways to read.** By default, ask Core when needed. Optionally, keep a live in-memory picture of every Asset and Task, read through the same calls. The picture is rebuilt from Core after a restart; there is no disk cache.
5. **Readiness is explicit.** While the picture is loading or out of date, reads say so; they never return an empty answer as if it were true.
6. **Accepted is not done.** Core's acceptance and the Asset's reported result are separate facts, and the SDK keeps them apart.
7. **Retry without duplicates.** A retried request keeps its identity, so Core handles it once. Every send ends as accepted, rejected, or no answer yet; an unknown outcome is reported as unknown, not as failed.
8. **Bounded work.** Queues, retries and history reads have limits, and programs can stop and close what they opened.
9. **Losing access stops network work.** When keys are refused, the SDK stops sending and says why; what is already read stays readable.
10. **Helpers do not fly.** The SDK never runs or schedules physical work; the Asset's own software does.
11. **One optional observer.** A program can watch the SDK's own activity (connects, retries, drops) for diagnostics, without that slowing or breaking the SDK.
12. **Assets use it too.** There is an Asset-side client, not only an operator one.
13. **Recovery after reconnecting.** A program picks up where it left off when a link returns.
