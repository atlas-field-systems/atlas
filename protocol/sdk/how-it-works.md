# SDK how it works

Locked decisions for the first SDK. Matching protocol cuts are in 0.8
([changelog](../docs/changelog.md), [laws](../docs/laws.md),
[communication](../docs/communication.md)).

Nothing here generates code. Programs call the SDK; the SDK loads JSON
definitions and talks bytes on a transport adapter.

## One front door

Every program uses the SDK: **Core, bridges, operator apps, and Assets on IP**.

- The SDK validates on the way in and out against `definitions/`.
- **Core does not re-implement schema validation.** It calls the shared
  `check()` when a message did not already arrive through an SDK edge (for
  example a raw test inject). After a valid message, Core runs **business rules
  only** (online?, command listed in `admin.describe`?, duplicate `task_id`?).
- Helpers never schedule or fly physical work; the Asset's own software does.

## Identity module

One module owns:

1. **Keys on hello only** — attach `key` / `enrollment_key` when building
   `admin.hello` or `admin.operator_hello`; never on other types.
2. **Stamp** — set `from`, `seq`, and `time` on every outbound message.
   - Asset: `from` = its `asset_id`
   - Operator: `from` = its `operator_id`
   - Core: `from` = `CORE` when Core creates the message
3. **Remember / dedupe** — key is `(from, seq, time)`. A retry is the same bytes
   again. Dedupe stops a message being **acted on** twice; it does not stop
   delivery to `stream`, `subscribe` or the live picture (replays still arrive).
   `subscribe` gets `{msg, raw, duplicate}` so acting code can skip replays.
   Contact advances on non-duplicate post-hello inbound with this Asset's
   `asset_id` whose `from` is not this Asset. Auth loss hard-stops stamping and
   sending; already-read local data may stay readable.

Core keeps a **last-answer cache** so a retried request gets the same
`admin.reply` again. Core does **not** keep a second dedupe set that can swallow
retries.

## Origin and forwarding (D1)

Every message carries `from`. Core **forwards other creators' messages
unchanged** (same `from`, `seq`, `time`). Replies name the original with
`reply_from` + `reply_to`. Law 2 was changed on purpose to allow `from`.

A deliberate repeat of content is a **new** message with a new `seq` from its
creator — never a silent renumber of someone else's bytes.

## Handshake vs description (D9)

1. `admin.hello` / `admin.operator_hello` — keys, version, id only.
2. After an accepted Asset hello, the Asset sends **`admin.describe`** (reports,
   commands, cameras). No keys. Core stores it and forwards it unchanged.
3. **`admin.asset` is removed.**

## Caller surface (D3)

| Call | Behavior |
| --- | --- |
| `request` | Send one message; wait for matching `admin.reply` |
| `stream` | Receive the messages that match the query until the matching `admin.reply` |
| `subscribe` | Live filter by type/kind until unsubscribed; callback `{msg, raw, duplicate}` |

Outcomes for a finished `request` / `stream`:

- **`accepted`** — peer accepted (Core passed it on, or hello accepted). Not the
  same as a Task being done; done arrives on `subscribe` to `report.status`.
- **`rejected`** — peer refused with an explanation.
- **`unknown`** — timeout or disconnect before a reply. **Not** "failed". Do not
  auto-retry non-idempotent operator commands.

An empty query that matches nothing is `accepted` with zero items (reply alone).

Raw `send` / `onMessage` may exist for diagnostics; apps should prefer the three
calls above.

## Live picture (D4)

- **Default:** on-demand reads (`request` / `stream` / queries).
- **Opt-in:** a live in-memory picture of Assets and Tasks, read through the same
  calls. Rebuilt from Core after connect; no disk cache.
- **Readiness is explicit.** While loading, reads say so; they never return an
  empty list as if it were true.
- **On disconnect:** last snapshot stays readable with `stale: true` (ready may
  stay true with that flag). Auth loss can still expose the last snapshot
  read-only while network sends stop.
- Assets do **not** need the live picture for v1.

## Queue without `task_seq` (D6)

- Core owns an ordered list of `task_id`s per Asset.
- Core sends each task body once; the Asset reports `report.status` kind `queue`;
  Core resends missing bodies.
- The Asset runs in list order. **No `task_seq`, no 10 s gap-wait.**

## Transport adapters (D5)

Bytes only:

```text
open / send(bytes) / onData(bytes) / onClose / close
```

Framing, JSON, and compression stay in the SDK or the link profile. Adapters do
not send or receive message objects.

## Reconnect (D8)

**Asset SDK**, on every accepted hello, automatically:

1. Send `admin.describe`.
2. Send the connect `report.settings`.
3. Resend unfinished final task reports (retries).
4. Send the current queue report.
5. Send `query.queue`.

**Operator** live picture rebuilds from Core's connect push (`admin.describe` +
latest reports). Inflight `request` → `unknown`. No auto-retry of operator
commands.

## Thin slice (implementation order, when building starts)

1. Load definitions + shared `check(msg)`
2. `build(type, fields)` → type, time, seq, from, then check
3. Transport interface + one WebSocket adapter
4. Link hello (Asset and operator) + `admin.describe` after Asset hello
5. Identity remember/dedupe on `(from, seq, time)`
6. `request` / `stream` / `subscribe`
7. Asset-side queue by `task_id` (Core-owned order; no `task_seq`)

## Already closed (do not reopen)

One front door; typed values; check at the edges; readiness; accepted ≠ done;
retry without duplicates; bounded work; auth loss stops network; helpers never
fly; one optional observer; Assets and Core use the SDK; no generated code;
strict version mismatch refuses the link.
