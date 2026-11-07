# Calls

How a program sends a message and gets its answer: `request`, `stream` and
`subscribe`.

## Caller surface (D3)

| Call | Behavior |
| --- | --- |
| `request` | Send one message; wait for matching `admin.reply` |
| `stream` | Receive the messages that match the query until the matching `admin.reply`; the finished result lists them oldest first |
| `subscribe` | Live filter by type/kind until unsubscribed; callback `{msg, raw, duplicate}` |

Outcomes for a finished `request` / `stream`:

- **`accepted`**: peer accepted (Core passed it on, or hello accepted). Not the
  same as a Task being done; done arrives on `subscribe` to `report.status`.
- **`rejected`**: peer refused with an explanation. Nothing ran.
- **`failed`**: only for a `plugin.call`. The Plugin ran and broke, with an
  explanation. Results that arrived before it stand.
- **`unknown`**: timeout or disconnect before a reply. **Not** `failed`: it may
  have run. Do not auto-retry non-idempotent operator commands.

An empty query that matches nothing is `accepted` with zero items (reply alone).

Raw `send` / `onMessage` may exist for diagnostics; apps should prefer the three
calls above.

## Module: `calls.mjs`

```js
export function request(link, msg, opts?: { timeoutMs?: number /*default 10000*/, signal?: AbortSignal }):
  Promise<Result>
export function stream(link, msg, opts?: { timeoutMs?, maxItems?: number /*default 10000*/, signal? }):
  AsyncIterable<Message> & { result: Promise<Result> }
export function subscribe(link, filter: { type?: string|string[], kind?: string|string[],
  asset_id?: string, from?: string } | ((m) => boolean),
  cb: (inb: {msg, raw, duplicate: boolean}) => void): () => void  // unsubscribe; same shape as onMessage

Result =
  { outcome: 'accepted', reply: Message, items?: Message[] }
| { outcome: 'rejected', reply: Message, explanation: string }
| { outcome: 'failed', reply: Message, explanation: string, items: Message[] }  // plugin.call only
| { outcome: 'unknown', reason: 'timeout' | 'disconnected' | 'aborted' | 'auth_lost' }
// every variant also has sent: { msg, raw } (the stored request bytes)
```
Matching: a reply matches a pending entry when `reply.reply_from === msg.from && reply.reply_to === msg.seq`.
Which reply closes a pending entry depends on who is calling:
- **Operator** (peer is Core): only Core's `admin.reply`. An Asset's later
  `report.settings` naming the same request is the confirmed **effect**, not the
  close. It is ordinary report traffic and goes to `subscribe` like any other
  report (accepted is not done).
- **Core** calling an Asset (`control.settings`, `control.cancel`): the Asset's
  `report.settings` with `reply_from`/`reply_to` closes it.
Map `reply_result: 'refused'` to `rejected` and `reply_result: 'failed'` to `failed` (only a `plugin.call` gets it: the Plugin ran and broke, and the items before it stand).

`stream`: between send and the matching reply, an inbound message on that link
that is not a reply is a stream item when it matches the query's own fields,
yielded once per `(from, seq, time)`. Every inbound message still goes to
subscribers and the picture as usual. Matching: `query.core kind history` takes
`report.<report>` (any report when `report` is left out) with
`since <= time <= until` where set; `kind assets` takes `admin.describe`;
`query.asset` takes `report.<report>`; each also takes only the query's
`asset_id` when set. `query.core kind plugins` takes `plugin.describe`.
`plugin.call` takes `plugin.result` whose `reply_from`/`reply_to` name the call;
a `plugin.result` is an item, never the close. A matching message is a true answer whether Core sent it in
the answer, forwarded it live meanwhile, or had it in flight when the query was
sent. So the SDK needs no correlation field, and streams on one link may overlap.
Items are yielded as they arrive. Core sends a history answer oldest first, and
the finished result's `items` are sorted by `time` (then `from`, `seq`), so a
live item that arrived between them takes its place in time.

Pending-request table, per link: `Map<seq, {msg, resolve, timer, kind:'request'|'stream', items[]}>`.
The key is just `seq`, because `from` is always this identity.
- On disconnect, resolve every pending entry `unknown/disconnected`. Never reject.
- On timeout, resolve `unknown/timeout`. A late reply after timeout gets an observer event `late_reply` and is **still delivered to subscribers**.
- `stream` resets its timeout on each item, so a long history read does not time out while answers are still arriving.
- Never auto-retry. Every Result carries `sent: { msg, raw }`. `retry(result)` (one name, no other variant) resends `result.sent.raw` unchanged (same from/seq/time) and re-arms the pending entry. Allowed for any message. Docs say not to retry non-idempotent commands automatically; a manual retry of the same bytes is safe because of dedupe plus Core's last-answer cache.
- Bounded: `maxPending` per link (default 256). Over the cap, `request` throws `SdkError('busy')`.

## Outcome and errors

```js
export const Outcome = { ACCEPTED: 'accepted', REJECTED: 'rejected', FAILED: 'failed', UNKNOWN: 'unknown' }
export class SdkError extends Error { code: 'invalid'|'auth_lost'|'timeout'|'busy'|'closed'|'not_ready'|'clock_unset'; detail }
```
Rule: a protocol outcome is a **Result value**. Programmer errors and hard stops
are **throws**. `unknown` is never turned into failure. `accepted` never means
done (Task completion arrives via `subscribe({type:'report.status', kind:'task'})`).

Auth loss (concept 9): on a refused hello, call `identity.stop('refused')`. (A
dropped link is just a disconnect; if the keys were revoked, the next reconnect's
refused hello gives `auth_lost`.) Then every `build`/`request`/`send` throws
`SdkError('auth_lost')`, pending requests resolve `unknown/auth_lost`, reconnect
halts, and the observer gets `auth_lost`. Picture and queue state stay readable.
