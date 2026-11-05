# SDK how it works

Locked decisions for the first SDK (protocol 0.8). Do not reopen them unless the
developer changes a lock.

The SDK implements the wire rules in [communication.md](../docs/communication.md)
and the [laws](../docs/laws.md): the hello, duplicates, the task queue, settings,
link loss and reconnecting. This page covers only what the SDK adds on top.

Nothing here generates code. Programs call the SDK; the SDK loads JSON
definitions and talks bytes on a transport adapter.

## One front door

Every program uses the SDK: **Core, bridges, operator apps, and Assets on IP**.

- Callers build and read messages through helpers, not raw JSON. Fields,
  precision and left-out fields are kept exactly.
- The SDK validates on the way in and out against `definitions/`. Commands and
  every other message come from the definitions, never hardcoded.
- **Core does not re-implement schema validation.** It calls the shared
  `check()` when a message did not already arrive through an SDK edge (for
  example a raw test inject). After a valid message, Core runs **business rules
  only** (online?, command listed in `admin.describe`?, duplicate `task_id`?).
- Helpers never schedule or fly physical work; the Asset's own software does.
- Work is bounded. Queues, retries and history reads have limits, and programs
  can stop and close what they opened.
- One optional observer lets a program watch the SDK's own activity (connects,
  retries, drops) for diagnostics, without slowing or breaking the SDK.

## Identity module

One module owns:

1. **Keys on hello only.** Attach `key` / `enrollment_key` when building
   `admin.hello` or `admin.operator_hello`; never on other types.
2. **Stamp.** Set `from`, `seq`, and `time` on every outbound message.
   - Asset: `from` = its `asset_id`
   - Operator: `from` = its `operator_id`
   - Core: `from` = `CORE` when Core creates the message
3. **Remember / dedupe** by `(from, seq, time)`, following
   [Routing and duplicates](../docs/communication.md#routing-and-duplicates):
   a message is acted on once and still delivered to `stream`, `subscribe` and
   the live picture. `subscribe` gets `{msg, raw, duplicate}` so acting code can
   skip replays. The module also tracks
   [contact](../docs/communication.md#losing-the-link).
4. **Auth loss.** When keys are refused, the SDK stops stamping and sending and
   says why. Already-read local data stays readable.

Core keeps a **last-answer cache** so a retried request gets the same
`admin.reply` again. Core does **not** keep a second dedupe set that can swallow
retries.

## Caller surface (D3)

| Call | Behavior |
| --- | --- |
| `request` | Send one message; wait for matching `admin.reply` |
| `stream` | Receive the messages that match the query until the matching `admin.reply` |
| `subscribe` | Live filter by type/kind until unsubscribed; callback `{msg, raw, duplicate}` |

Outcomes for a finished `request` / `stream`:

- **`accepted`**: peer accepted (Core passed it on, or hello accepted). Not the
  same as a Task being done; done arrives on `subscribe` to `report.status`.
- **`rejected`**: peer refused with an explanation.
- **`unknown`**: timeout or disconnect before a reply. **Not** "failed". Do not
  auto-retry non-idempotent operator commands.

An empty query that matches nothing is `accepted` with zero items (reply alone).

Raw `send` / `onMessage` may exist for diagnostics; apps should prefer the three
calls above.

## Live picture (D4)

- **Default:** on-demand reads (`request` / `stream` / queries).
- **Opt-in:** a live in-memory picture of Assets and Tasks, read through the same
  calls. Rebuilt from Core's connect push (`admin.describe` + latest reports)
  after every connect; no disk cache, and no resuming a local cache without that
  replay. The replayed messages are delivered to the picture even if it has seen
  them.
- **Readiness is explicit.** While loading, reads say so; they never return an
  empty list as if it were true.
- **On disconnect:** last snapshot stays readable with `stale: true` (ready may
  stay true with that flag). Auth loss can still expose the last snapshot
  read-only while network sends stop.
- Assets do **not** need the live picture for v1.

## Transport adapters (D5)

Bytes only:

```text
open / send(bytes) / onData(bytes) / onClose / close
```

Framing, JSON, and compression stay in the SDK or the link profile. Adapters do
not send or receive message objects.

## Reconnect (D8)

- **Asset:** on every accepted hello, the SDK runs the
  [After reconnecting](../docs/communication.md#after-reconnecting-asset) steps
  itself, without waiting for the program.
- **Operator:** an inflight `request` across a drop becomes `unknown`. The SDK
  does not auto-retry operator commands. The live picture rebuilds as above.
