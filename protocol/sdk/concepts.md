# SDK concepts (locked)

Rewritten to match the 0.8 locks. Supersedes the pre-0.8 README list.

1. **One front door.** Every program (Core, bridges, operator apps, Assets on IP)
   uses the SDK. Core calls shared `check()`; it does **not** re-implement
   schema validation as a second engine. Business rules stay in Core.
2. **Typed values, not raw JSON.** Callers build and read messages through
   helpers. Fields, precision and left-out fields are kept exactly.
3. **Check at the edges.** Messages are checked against Protocol's definitions on
   the way in and on the way out. Commands and every other message come from the
   definitions, never hardcoded.
4. **Two ways to read.** By default, ask Core when needed. Optionally, keep a live
   in-memory picture of every Asset and Task, read through the same calls. The
   picture is rebuilt from Core after connect; there is no disk cache. On
   disconnect the last snapshot stays readable as `stale: true`.
5. **Readiness is explicit.** While the picture is loading or out of date, reads
   say so; they never return an empty answer as if it were true.
6. **Accepted is not done.** Core's acceptance and the Asset's reported result are
   separate facts, and the SDK keeps them apart. Outcomes are `accepted`,
   `rejected`, or `unknown`.
7. **Retry without duplicates.** A retried request keeps `(from, seq, time)`, so
   Core handles it once and can resend the last answer. Unknown outcomes stay
   unknown, not failed.
8. **Bounded work.** Queues, retries and history reads have limits, and programs
   can stop and close what they opened.
9. **Losing access stops network work.** When keys are refused, the SDK stops
   sending and says why; what is already read stays readable.
10. **Helpers do not fly.** The SDK never runs or schedules physical work; the
    Asset's own software does.
11. **One optional observer.** A program can watch the SDK's own activity
    (connects, retries, drops) for diagnostics, without that slowing or breaking
    the SDK.
12. **Assets use it too.** There is an Asset-side client, not only an operator one.
    Core uses it as well (`from` = `CORE` when Core creates messages).
13. **Recovery after reconnecting.** Asset SDK auto: final-report retries, queue
    report, `query.queue`. Operator live picture rebuilds from Core's connect push.
    No auto-retry of operator commands.
14. **Bytes-only transports.** Adapters expose `open` / `send` / `onData` /
    `onClose` / `close`. Framing stays above them.
15. **Identity in one place.** Keys on hello only; stamp `from`/`seq`/`time`;
    remember for dedupe. Core last-answer cache only — no second dedupe set.
16. **Caller surface.** `request`, `stream`, and `subscribe` are the default API.
