# Atlas SDK implementation plan (protocol 0.8)

For a coding agent building the SDK runtime in `sdk/`. What each module does, with
its signatures and invariants, is in the [SDK docs](README.md#docs), and the wire
rules are Protocol's [laws](../protocol/docs/laws.md) and
[Communication](../protocol/docs/communication.md). This file covers **how to build
it**: the file layout, the order of PRs, and tests. If this plan and those docs
disagree, the docs win. Stop and ask; do not invent a fix.
Read [AGENTS.md](../AGENTS.md) first: the Charter comes before this plan, and its
working rules (commit identity, privacy, merging, CI, no CDN) apply to every slice.

Ground rules:

- `protocol/definitions/` is the source of truth. The SDK never names a message type
  except the few it must handle mechanically. The full allow-list is in
  [Messages](docs/messages.md#names-the-sdk-may-hardcode).
- No codegen, no OpenAPI, no TypeScript build step. Plain ESM `.mjs` with JSDoc
  types.
- Bloat is the enemy (AGENTS.md). Define nothing twice. Lift code from
  `protocol/lib/protocol.mjs`; do not copy it.

---

## 1. Constraints

| Item | Rule |
| --- | --- |
| Runtime | Node **>= 22.13** (matches Core `engines`). Add `"engines": {"node": ">=22.13"}` to the SDK package. |
| Modules | ESM only (`"type": "module"`), `.mjs` files. |
| Tests | `node --test`; no Jest or Mocha. The SDK has its own `npm test` (`node --test test/*.test.mjs`). Slice 1 adds `.github/workflows/sdk.yml`, which runs it when `sdk/` or `protocol/` changes. |
| Deps | SDK: `ajv`, `ajv-formats` in its own `package.json`. WebSocket adapter: `ws` (Core already uses `^8.18`) in the adapter's own `package.json`. `protocol/lib/protocol.mjs` resolves its imports from `protocol/node_modules`, so SDK CI runs `npm ci` in `protocol/` too. Nothing else without asking. |
| Network | No remote `$ref` fetch, no network at load time. Definitions are read from disk. |
| Browser | Not a v1 target for the SDK runtime. The viewer keeps using `protocol/lib/protocol.mjs`. Keep `src/` free of `fs` except in `definitions.mjs`, so browser support stays possible later. |
| Clock | `now()` is injectable everywhere (tests use a fake clock). Never call `Date.now()` directly outside `clock.mjs`. |
| Process | One PR per slice below. Do not touch Core in these PRs. |

---

## 2. Layout

```text
protocol/
  lib/protocol.mjs          KEEP. Viewer and CLI use it. The SDK imports loadProtocol/validate/messageFile from here.
  definitions/              loaded by the SDK at runtime
sdk/
  README.md                 update the status line and layout per slice
  AGENTS.md                 rules for agents working here
  IMPLEMENTATION.md         this plan
  docs/                     one doc per part: what each module does (draft; change it with the developer, not in a slice)
  package.json              name "@atlas/sdk", private, type module, exports "./src/index.mjs"
  src/
    index.mjs               public exports only
    definitions.mjs         loadDefinitions(): reads ../../protocol/definitions from disk, wraps lib loadProtocol
    check.mjs               check(msg) -> {ok, errors, file, kind}
    build.mjs               build(type, fields, {identity}) -> stamped, checked message
    codec.mjs               encode(msg) -> Uint8Array; decode(bytes) -> msg  (JSON + UTF-8; framing hook); keeps raw bytes
    clock.mjs               now() default and makeClock(); monotonic guard
    identity.mjs            createIdentity(): keys, stamping, seq counter, dedupe window, auth state
    dedupe.mjs              DedupeWindow (per-from ring of (seq,time)), used by identity
    link.mjs                createLink(): transport + codec + identity + hello state machine + dispatch
    calls.mjs               request / stream / subscribe on top of link
    outcome.mjs             Outcome constants and the SdkError class
    asset-queue.mjs         createAssetQueue(): task_id list, task store, final-report retries, answer replay
    reconnect.mjs           backoff policy and the Asset auto-resync sequence
    picture.mjs             OPTIONAL createLivePicture() (slice 9)
    observer.mjs            OPTIONAL observer plumbing (safe emit)
  adapters/
    transport.mjs           the Transport interface (JSDoc) + assertTransport()
    fake.mjs                in-process pair: createFakePair() -> [a, b]; test-only but shipped
    websocket/
      package.json          "@atlas/transport-websocket", deps: ws
      index.mjs             wsClient(url), wsServer({port}) -> onConnection(transport)
  test/
    check.test.mjs
    build.test.mjs
    codec.test.mjs
    identity.test.mjs
    link.test.mjs
    calls.test.mjs
    asset-queue.test.mjs
    reconnect.test.mjs
    first-flight.test.mjs   in-process fake-transport run of protocol/examples/first-flight
    helpers/mini-core.mjs   tiny test Core built only on SDK calls (NOT the real Core)
```

Packaging note: adapters are "their own packages beside the SDK" (design
decision). For v1 keep `adapters/websocket/` as its own `package.json` in the same
repo, imported by relative path from tests. Do **not** add npm workspaces or
publishing unless the developer asks. `fake.mjs` stays inside the SDK because
every test needs it.

What to lift from `protocol/lib/protocol.mjs`: `loadProtocol`, `validate`, `messageFile`,
`kindsOf`. Import them. Do not fork them. If `validate` needs a change (for
example returning structured errors), change it in `protocol/lib/` and keep the viewer
tests green. Core's private Ajv loader is deleted later, in the Core adopt PR,
not here.

---

## 3. Modules

All exported from `sdk/src/index.mjs`. Signatures and invariants live in the SDK docs:

| Modules | Doc |
| --- | --- |
| `definitions.mjs`, `check.mjs`, `build.mjs`, `codec.mjs` | [Messages](docs/messages.md) |
| `identity.mjs`, `dedupe.mjs`, `clock.mjs` | [Identity and duplicates](docs/identity-and-duplicates.md) |
| `adapters/`, `link.mjs`, `reconnect.mjs`, `observer.mjs` | [Links](docs/links.md) |
| `calls.mjs`, `outcome.mjs` | [Calls](docs/calls.md) |
| `asset-queue.mjs` | [Task queue](docs/task-queue.md) |
| `picture.mjs` | [Live picture](docs/live-picture.md) |

---

## 4. Build slices (one PR each)

Every PR updates the `sdk/README.md` status line and runs Protocol's `npm run check` and the SDK's `npm test`.

### Slice 1: Definitions, `check`, `build`, codec, clock
Files: `package.json`, `definitions.mjs`, `check.mjs`, `build.mjs`, `codec.mjs`, `clock.mjs`, a minimal `identity.mjs` (stamp + seq only), `outcome.mjs`, `index.mjs`, `.github/workflows/sdk.yml`.
Acceptance:
- Every example in every definition (`examples[]`) passes `check`. Every file in `protocol/examples/first-flight` and `protocol/examples/operator-session` passes.
- Mutations fail with a useful path: extra field, missing `from`, bad `kind`, key on `admin.describe`, `from` longer than 4 chars, `semi_minor_m` without `orientation_deg`, `semi_minor_m` larger than `semi_major_m`.
- `build` stamps `from/seq/time`, rejects caller-supplied ones, and the output key order follows law 3.
- A failed `build` does not consume a seq.
- `build` works for every type and kind with no per-type code (the generic test).
- `encode∘decode` round-trips are byte-stable for all examples.

### Slice 2: Transport interface, fake pair, WebSocket adapter
Files: `adapters/transport.mjs`, `adapters/fake.mjs`, `adapters/websocket/*`.
Acceptance:
- `assertTransport` accepts both adapters.
- Bytes in equal bytes out (binary, including multibyte UTF-8). `close` is idempotent and fires `onClose` once on both ends.
- The fake supports latency, drop, duplicate and reorder knobs, with a seeded RNG for deterministic tests.
- A WS test on an ephemeral port on 127.0.0.1 (no external network).

### Slice 3: Link + hello + describe (D9)
Files: `link.mjs`, inbound pipeline without dedupe (dedupe lands in slice 4), observer basics.
Acceptance (fake transport plus a test server built from `createLink({side:'server'})`):
- Asset hello accepted → describe from `opts.describe`, then (after its `admin.reply`) connect `report.settings` from `opts.connectSettings` when provided, then (after its `admin.reply`) `ready`; a lost reply is covered by resending the same bytes; describe carries no key and no version.
- Lost acknowledgements: drop the first `admin.reply` to the describe and then to the connect report. Each is resent after 10 s (fake clock), the next reply passes the pre-ready filter, and the link reaches `ready`. A Task body that arrives before `ready` is dropped, not remembered, and its resend after `ready` is handled.
- Operator hello accepted → `ready`, with no describe.
- A message before the hello is accepted is refused locally (`not_ready`). A server receiving a non-hello first closes.
- `version_mismatch` → `open()` rejects, state set, no reconnect.
- `refused` → `auth_lost`, after which `build` throws `auth_lost`.
- Invalid inbound bytes are dropped with an observer event, and the link survives.

### Slice 4: Identity dedupe (D1/D7)
Files: `identity.mjs` (full), `dedupe.mjs`.
Acceptance:
- A duplicate `(from,seq,time)` is acted on once: flagged `duplicate:true`, still delivered to readers. The same seq with a different time is new (restart case).
- A handler that throws still leaves the message remembered; its duplicate is flagged.
- `contact()` / `lastContact` advances on non-duplicate inbound messages after the accepted hello with `asset_id === this id && from !== this id`. `build` throws `clock_unset` before the clock is set.
- Out-of-order unseen messages are delivered.
- The window holds ≥1024 per `from`. After eviction, behavior is documented. Memory stays bounded with 10k distinct `from`.
- Seq survives link reconnect on the same identity. `time` never goes backwards under a fake clock stepping back.
- The `onDuplicate` hook fires (the hook Core will use for its last-answer cache). The SDK holds no answer cache. Assert there is no reply storage in identity.

### Slice 5: `request` / `stream` / `subscribe` (D3)
Files: `calls.mjs`.
Acceptance:
- `request` accepted, rejected (with explanation), unknown on timeout, and unknown on disconnect. Disconnect never rejects the promise.
- Matching uses `(reply_from, reply_to)`. A reply for another sender with the same seq is ignored (the D1 regression test from the prototypes).
- `stream` for `query.core kind history` yields N items then resolves with the reply. An empty query gives `accepted` with zero items. `maxItems` overflow → abort + `unknown/aborted`.
- `subscribe` filters by type, kind and asset_id; callback is `(inb: {msg, raw, duplicate}) => void` (same as `onMessage`). Acting subscribers must skip when `duplicate === true` (a completed-task script or failsafe alert must not re-fire on a mesh duplicate or a connect-push replay). Unsubscribe stops delivery. A throwing subscriber does not break others.
- Bounded: `maxPending` gives `busy`. `AbortSignal` works.
- Operator `control.settings` resolves on Core's `admin.reply`; the Asset's later `report.settings` is **not** the close and reaches subscribers. Core-side `control.settings` to an Asset resolves on `report.settings` with reply fields.
- A late reply after timeout reaches subscribers.
- A `query.core kind history` answer for telemetry already seen live is still yielded by the stream.
- Live telemetry that the test server forwards after the reply is **not** in the stream result; subscribers and the picture get it.
- The test server forwards A2 telemetry and A1 telemetry, then answers an A1 history query (no `until`) that includes that same A1 message. The stream yields the A1 message once and no A2 message. With `until` before that message's `time`, it is not an item. Subscribers get both forwards.
- Two overlapping streams on one link each yield their own matches.
- A history answer with a live A1 item arriving between two older answers: the stream yields all three as they arrive, and `result.items` lists them by `time`.
- `plugin.call`: two `plugin.result` items then `admin.reply` accepted gives `accepted` with both items. One item then `admin.reply` failed gives `failed` with its explanation and that item. Refused gives `rejected` with no items. No reply gives `unknown`. `query.core kind plugins` yields each `plugin.describe`.
- `stream` timeout resets on each item. `retry(result)` resends byte-equal stored bytes.

### Slice 6: Asset queue helper (D6)
Files: `asset-queue.mjs`.
Acceptance:
- T1, T2, T3 bodies give run order T1, T2, T3. A duplicate T2 body while held is ignored. A body for a finished task resends its stored final report bytes. T1+T3 with T2 missing runs T1, T3 and does **not** wait (a correct Core never sends T3 before the Asset shows T2; order is Core's job).
- A finished `task_id` is never emitted again, including after a simulated restart with a store. The store keeps ≥1024 finished ids and evicts the oldest.
- `clear()` reports each held task cancelled, then an empty queue report. A body that arrives after `clear()` is held, not dropped (the app's pause keeps it from running).
- A motion command without `task_id` cancels the queue, reports each task cancelled, then sends an empty queue report. An immediate `control.settings` does not touch the queue. A queued `control.settings` with `task_id` is a task.
- Cancel before arrival: reported cancelled; the later body is never run and gets the cancelled report again. Every cancel and settings request gets a `report.settings` answer; a duplicate request gets the identical answer bytes.
- A final report is retried with identical bytes every 10 s (fake clock) with no attempt cap, until a matching `admin.reply` (+ `task_id`) arrives, then stops. Ack state lives in the store (`acked`); after a simulated restart with a persistent store, unacked finals keep retrying.
- A `control.cancel` without `task_id` (stop motion now) is emitted to `onImmediate`.

### Slice 7: Reconnect (D8)
Files: `reconnect.mjs`.
Acceptance:
- Asset: drop the transport mid-task. On the next accepted hello, the order on the wire is describe → connect `report.settings` → unacked final reports → queue report → `query.queue`.
- Operator: an in-flight request resolves `unknown/disconnected`. A command is **not** resent after reconnect.
- Backoff grows and is capped. No reconnect after `auth_lost` or `version_mismatch`.
- Seq stays continuous across reconnects.

### Slice 8: First-flight path, end to end in-process
Files: `test/first-flight.test.mjs`, `test/helpers/mini-core.mjs`.
`mini-core` is a ~150-line test double built **only** from SDK calls (server
links, `check`, dedupe hook, a last-answer Map, an ordered task list, forward
unchanged). It proves that Core can be written on the SDK. It is **not** the real
Core and does not ship. Acceptance:
- Replay `protocol/examples/first-flight/scenario.json` (sim Asset A1 + operator OP1 + mini-core over fake transports, with duplicate and reorder knobs on).
- Forwarded messages arrive with the same `from/seq/time` (byte-equal), so nothing is renumbered.
- The operator gets one `admin.reply` per message. A retried command gets the same reply bytes (last-answer cache in mini-core).
- mini-core sends each task only after A1 lists the one before. With T2's first copy dropped, A1 still runs takeoff → move_to → land in that order.
- The Asset runs takeoff → move_to → land once each. Final reports are acked. A mid-run link loss recovers via slice 7. mini-core forwards with `forward(raw)` and sends `admin.alive` when quiet.
- Repeat the run with 10% drop and 10% duplicate (seeded): still exactly-once task execution.

### Slice 9: Optional live picture + observer polish (D4)
Files: `picture.mjs`, `observer.mjs`.
Acceptance: reads return `ready:false` while loading. After the picture's own
`query.core kind assets` reply, `ready:true` with the describes in it. On
disconnect, `stale:true` with data still readable. On reconnect, a full rebuild
from the replayed connect push even though every message is a duplicate. Upsert
keeps the newest `time`. Auth loss leaves a read-only snapshot. A throwing
observer and an async (never-resolving) observer do not affect message flow.

### Slice 10 (docs only): Core-as-caller notes
Write `sdk/docs/core-adopt.md` (short). It is the checklist for a **later**,
separate Core PR, not done here:
- Replace Core's Ajv loader with `check`. Replace the socket code with `wsServer` + `createLink({side:'server'})`.
- Core identity is `createIdentity({id:'CORE', role:'core', seqStore: <persisted>})`.
- Delete seq renumbering, `admin.asset`, the `task_seq` pass-through and the second dedupe set. Keep a last-answer cache keyed `(from,seq,time)` and wire it to `onDuplicate`.
- Forward with `link.forward(raw)` (byte-equal). Send `admin.alive` when Core has sent an Asset nothing new for a third of its `link_loss_after_s`.
- Business rules that stay in Core: key hash check, one-link-per-ID replace, online check (contact, not an open link), stop resending Tasks once an Asset goes offline and mark each Task it gave up `undelivered`, command listed in describe, `task_id` duplicate, ready (send an Asset no Task and pass nothing on to it, refusing operator `control.*`, until Core has acknowledged its connect report), ordered task list (send a task only after the Asset shows it holds the one before; drop unsent tasks when the Asset reports a task cancelled that Core passed on no cancel for, or goes offline; on passing on a motion command without `task_id`, drop unsent tasks and cancel each sent one the Asset has not shown it holds), `every_s` repeats (a new Core-created message each time, with a new seq).
- Pin Core to the release that contains the SDK.

---

## 5. Data structures (ownership)

| Structure | Owner | Shape | Bound |
| --- | --- | --- | --- |
| seq counter | Identity (SDK) | `{seq:number, lastTime:number}`; Core persists via `seqStore` | n/a |
| dedupe window | Identity (SDK) | `Map<from, {ring:Array<[seq,time]>, set:Set<string>}>` | 1024/from, 4096 froms LRU |
| pending requests | Link/calls (SDK) | `Map<seq, Pending>` per link | `maxPending` 256 |
| stream buffer | calls (SDK) | array per stream | `maxItems` 10000 |
| subscribers | Link (SDK) | `Set<{filter,cb}>` | caller-owned |
| asset task list | AssetQueue (SDK, Asset side) | `string[]` | none (no protocol way to refuse; open question) |
| finished tasks (final bytes + `acked`, cancel-before-arrival included), Asset answers | TaskStore (Map-like, `new Map()` default) | `task:<id>`, `answer:<from:seq:time>` | ≥1024 each, oldest deleted |
| **last-answer cache** (forwarded traffic) | **Core (not SDK)** | `Map<"from:seq:time", replyBytes>` | Core's choice |
| Core ordered task_id list | **Core** | per Asset | Core |
| live picture | Picture (SDK, optional) | maps per asset | memory only |

---

## 6. Test strategy

- Unit tests per module (see the [SDK docs](README.md#docs)), all on the fake clock and fake transport. Deterministic: seeded RNG and no real timers (use `node:test` mock timers or injected `setTimeout`).
- One integration test: slice 8 first-flight over the fake pair, clean and lossy.
- One WS smoke test on localhost (slice 2). Optionally rerun slice 8 over WS.
- The generic-type test (every definition example through `build`/`check` with no per-type code) guards "new message = zero SDK code."
- Protocol's own tests keep passing. The SDK's tests run from `sdk/` with its own `npm test`.
- No test hits the internet.

---

## 7. Not now

- Fusion and track messages (no wire types exist). Fetching an Object's file. Geo feature and Object messages go through the generic front door with no SDK code.
- Meshtastic and FLRC adapters. The interface exists; write no implementation and no framing profile.
- Byte-stream framing, compression and chunking (link profile work, law 12).
- Rewriting or adapting Core (only `core-adopt.md` notes). No Core submodule bump.
- Disk cache for the picture. Browser builds. npm publishing or workspaces.
- Auto-retry of operator commands. Any `task_seq` or gap-wait. A Core-style last-answer cache in the SDK (the Asset helper's own answer replay is in scope).
- Generated clients, TypeScript, OpenAPI.
- New protocol fields or laws. If a slice seems to need one, stop and raise it.

---

## 8. Invariants checklist (each PR)

- [ ] No message type named outside the [allow-list](docs/messages.md#names-the-sdk-may-hardcode).
- [ ] `from/seq/time` stamped only by identity. Keys only on hello types.
- [ ] Forwarding never changes bytes (`forward(raw)`).
- [ ] Dedupe gates acting, never delivery to readers.
- [ ] `unknown` never mapped to failure. Disconnect never rejects a promise.
- [ ] Every queue, map and buffer has a bound.
- [ ] Observer errors are swallowed.
- [ ] No `Date.now()` outside `clock.mjs`. No network in tests except localhost WS.

---

## 9. Current implementation points

The developer's current choices. A slice follows them; to change one, raise it with
the developer instead of changing it inside a slice.

- **Dedupe (all slices):** act once, deliver always. Dedupe stops a message being acted on again; streams, subscribers and the picture still receive replays. The picture upserts by `(from, seq, time)`, newest `time` wins.
- **Contact (slice 4):** `lastContact` / `contact()` advances on non-duplicate post-hello inbound with `asset_id === this id && from !== this id` (not only `from: CORE`).
- **Streams (slice 5, replaces P1):** a stream's items are the inbound messages that match its query's fields, once per `(from, seq, time)`, until its reply ([Calls](docs/calls.md#module-callsmjs)). No interleave rule and no one-stream-per-link limit. Core sends a history answer oldest first; the finished result is sorted by `time`.
- **Subscribe (slice 5):** callback is `{msg, raw, duplicate}` (same as `onMessage`); acting code skips duplicates.
- **P2 (slice 9):** the live picture issues its own `query.core kind assets` on connect and reconnect, and is `ready` when that request's `admin.reply` arrives. It does not try to detect the end of Core's connect push.
- **P3 (slice 2):** each transport adapter is a sibling package with its own `package.json`. No npm workspaces.
- **P4 (slice 6):** the Asset queue takes a Map-like store (`get`/`set`/`delete`/`keys`, default `new Map()`), see [Task queue](docs/task-queue.md). One record per finished task (final bytes + `acked`) and one per answer, newest ≥1024 of each kept. A cancel before arrival is a finished task whose final is `cancelled`.
- **Post-hello sequence (slices 3/6):** after every accepted hello, including the first, the link sends describe → connect `report.settings`, each waiting for Core's `admin.reply`, and then sets `ready`; the Asset queue's `ready` listener sends unacked finals → queue report → `query.queue`. `createLink` takes `connectSettings`.

## 10. How to work this plan

- One slice per PR, in order. Each PR passes its acceptance tests and the section 8 checklist.
- Do not start the next slice before the previous one is merged.
