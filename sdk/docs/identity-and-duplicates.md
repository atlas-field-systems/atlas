# Identity and duplicates

How the SDK stamps who sent a message and stops a repeated message being acted on
twice. The wire rule is [Routing and duplicates](../../protocol/docs/communication.md#routing-and-duplicates).

## What it does

One module owns:

1. **Keys on hello only.** Attach `key` / `enrollment_key` when building
   `admin.hello` or `admin.operator_hello`; never on other types.
2. **Stamp.** Set `from`, `seq`, and `time` on every outbound message.
   - Asset: `from` = its `asset_id`
   - Operator: `from` = its `operator_id`
   - Core: `from` = `CORE` when Core creates the message
3. **Remember / dedupe** by `(from, seq, time)`, following
   [Routing and duplicates](../../protocol/docs/communication.md#routing-and-duplicates):
   a message is acted on once and still delivered to `stream`, `subscribe` and
   the live picture. `subscribe` gets `{msg, raw, duplicate}` so acting code can
   skip replays. The module also tracks
   [contact](../../protocol/docs/communication.md#losing-the-link).
4. **Auth loss.** When keys are refused, the SDK stops stamping and sending and
   says why. Already-read local data stays readable.

Core keeps a **last-answer cache** so a retried request gets the same
`admin.reply` again. Core does **not** keep a second dedupe set that can swallow
retries.

## Module: `identity.mjs` and `dedupe.mjs` (D7)

The bounded ring below is a proposed duplicate lookback, not a sufficient
implementation of Protocol's no-repeat and unchanged-answer guarantees.
Before implementing effectful dispatch, select paired retention for handled
side-effect identities and original answers; cache eviction must not authorize
another effect. Operation-long paired retention is the tested provisional
baseline. The owner will determine budgets through integration tests; exact
limits and safe release remain open. See the [prototype findings](../../core/docs/experiments/final-report.md#duplicate-prevention-and-retention).

```js
export function createIdentity(opts: {
  id: string,                  // asset_id | operator_id | 'CORE'
  role: 'asset' | 'operator' | 'core',
  key?: string, enrollmentKey?: string,
  now?: () => number,
  dedupeSize?: number          // default 1024 per from (communication.md)
}): Identity

Identity = {
  id, role,
  stamp(draft): Message        // from/seq/time (+keys on hello types only)
  seen(msg): boolean           // true if (from,seq,time) already handled
  remember(msg): void
  stop(reason): void           // auth loss: stamp() throws thereafter
  stopped: null | { reason }
}
```
Invariants:
- Keys are attached **only** to `admin.hello` / `admin.operator_hello`. `stamp` throws if a draft for any other type already carries `key`/`enrollment_key`.
- There is one in-memory seq counter per identity for the operation, shared across all links. It does not reset on reconnect. Processes stay running for the operation; no restart recovery or persisted counter is required.
- `time = max(now(), lastTime)`. It never goes backwards. If `now()` is earlier than `lastTime`, use `lastTime` (same ms is allowed; seq disambiguates).
- Dedupe key: `(from, seq, time)`. Dedupe concerns acting, not delivery ([Links](links.md#link)). The proposed per-`from` ring (Map + array, size N, oldest evicted) bounds only generic lookback memory by `N × distinct from`, with a proposed 4096-creator LRU cap. Neither eviction grants permission to repeat an effect; protected identity and answer retention must be resolved before implementing those paths.
- No Core-style last-answer cache in the SDK for forwarded traffic. That cache belongs to **Core** (business layer); the SDK exposes `seen()` and `onDuplicate` so Core can resend its cached reply.
- The Asset helpers are different: an Asset answers `control.settings` and `control.cancel` itself with `report.settings`, so the Asset queue helper keeps its own answer replay ([Task queue](task-queue.md)). It is separate from Core's cache; its answers must not expire while their requests remain protected against repeated effects.
- Contact (communication.md, Losing the link): identity records `lastContact`,
  the `now()` of the last non-duplicate inbound message after an accepted hello
  whose `asset_id` is this identity's ID and whose `from` is not this identity's ID.
  It exposes `identity.contact()` and an observer event `contact`.
  The SDK also exposes when the Asset last sent something new. The current
  check-in procedure sends a useful listed report early. It must not present an
  old position as a fresh fix or require periodic subsystem reports.
  Quiet-Asset check-ins remain [open](../../protocol/docs/open-questions.md#unresolved).
  Timing contact loss and evaluating [configured failsafe conditions](../../asset/docs/failsafes.md)
  are the Asset app's work. Contact loss alone does not require a physical response.
  A creator sends nothing until its clock is set. `build` throws
  `SdkError('clock_unset')` while `now()` returns null.
