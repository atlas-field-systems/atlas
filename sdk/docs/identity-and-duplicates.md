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
- Dedupe key: `(from, seq, time)`. Dedupe decides whether a message is **acted on**, not whether it is delivered ([Links](links.md#link)). Keep a per-`from` bounded ring (Map + array, size N, oldest evicted). Memory is bounded by `N × distinct from`. Add a cap on distinct `from` (default 4096, LRU).
- No Core-style last-answer cache in the SDK for forwarded traffic. That cache belongs to **Core** (business layer); the SDK exposes `seen()` and `onDuplicate` so Core can resend its cached reply.
- The Asset helpers are different: an Asset answers `control.settings` and `control.cancel` itself with `report.settings`, so the Asset queue helper keeps its own answer replay ([Task queue](task-queue.md)). It is Asset-side, bounded, and separate from Core's cache.
- Contact (communication.md, Losing the link): identity records `lastContact` (the `now()` of the last **non-duplicate** inbound message after an accepted hello whose `asset_id` is this identity's id and whose `from` is **not** this identity's id). Exposed as `identity.contact()` and an observer event `contact`. The Asset app sends `report.telemetry` early when it has sent nothing new for a third of its `link_loss_after_s`, so Core can count it connected; the SDK exposes when it last sent something new (communication.md, When Core counts an Asset offline). The SDK only reports contact; timing `link_loss_after_s` and triggering the `link_loss` failsafe is the Asset app's work (helpers never fly). A creator sends nothing until its clock is set: `build` throws `SdkError('clock_unset')` while `now()` returns null.
