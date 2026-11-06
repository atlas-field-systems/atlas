# Atlas SDK implementation plan (protocol 0.8)

For a coding agent building the SDK runtime in `protocol/sdk/`. The behavior
contract is already locked in `sdk/how-it-works.md`, `docs/laws.md` and
`docs/communication.md`. This file covers **how to build it**:
the file layout, signatures, invariants, the order of PRs, and tests. If this
plan and those docs disagree, the docs win. Stop and ask; do not invent a fix.
Read [AGENTS.md](../AGENTS.md) first: the Charter comes before this plan, and its
working rules (commit identity, privacy, merging, CI, no CDN) apply to every slice.

Ground rules:

- `definitions/` is the source of truth. The SDK never names a message type
  except the few it must handle mechanically. The full allow-list is in section 3.
- No codegen, no OpenAPI, no TypeScript build step. Plain ESM `.mjs` with JSDoc
  types.
- Bloat is the enemy (AGENTS.md). Define nothing twice. Lift code from
  `lib/protocol.mjs`; do not copy it.

---

## 1. Constraints

| Item | Rule |
| --- | --- |
| Runtime | Node **>= 22.13** (matches Core `engines`). Add `"engines": {"node": ">=22.13"}` to the SDK package. |
| Modules | ESM only (`"type": "module"`), `.mjs` files. |
| Tests | `node --test`; no Jest or Mocha. Add `sdk/test/*.test.mjs` to protocol's `npm test` glob. |
| Deps | SDK: `ajv`, `ajv-formats` (already in protocol). WebSocket adapter: `ws` (Core already uses `^8.18`), also added to protocol's root `devDependencies` and `package-lock.json` in slice 2 so CI's root `npm ci` installs it. Nothing else without asking. |
| Network | No remote `$ref` fetch, no network at load time. Definitions are read from disk. |
| Browser | Not a v1 target for the SDK runtime. The viewer keeps using `lib/protocol.mjs`. Keep `src/` free of `fs` except in `definitions.mjs`, so browser support stays possible later. |
| Clock | `now()` is injectable everywhere (tests use a fake clock). Never call `Date.now()` directly outside `clock.mjs`. |
| Process | One PR per slice below. Do not touch Core in these PRs. |

---

## 2. Layout

```text
protocol/
  lib/protocol.mjs          KEEP. Viewer and CLI use it. The SDK imports loadProtocol/validate/messageFile from here.
  sdk/
    README.md               update the status line and layout per slice
    how-it-works.md         locked contract (do not edit unless the developer changes a lock)
    IMPLEMENTATION.md       this plan
    package.json            name "@atlas/sdk", private, type module, exports "./src/index.mjs"
    src/
      index.mjs             public exports only
      definitions.mjs       loadDefinitions(): reads ../../definitions from disk, wraps lib loadProtocol
      check.mjs             check(msg) -> {ok, errors, file, kind}
      build.mjs             build(type, fields, {identity}) -> stamped, checked message
      codec.mjs             encode(msg) -> Uint8Array; decode(bytes) -> msg  (JSON + UTF-8; framing hook); keeps raw bytes
      clock.mjs             now() default and makeClock(); monotonic guard
      identity.mjs          createIdentity(): keys, stamping, seq counter, dedupe window, auth state
      dedupe.mjs            DedupeWindow (per-from ring of (seq,time)), used by identity
      link.mjs              createLink(): transport + codec + identity + hello state machine + dispatch
      calls.mjs             request / stream / subscribe on top of link
      outcome.mjs           Outcome constants and the SdkError class
      asset-queue.mjs       createAssetQueue(): task_id list, task store, final-report retries, answer replay
      reconnect.mjs         backoff policy and the Asset auto-resync sequence
      picture.mjs           OPTIONAL createLivePicture() (slice 9)
      observer.mjs          OPTIONAL observer plumbing (safe emit)
    adapters/
      transport.mjs         the Transport interface (JSDoc) + assertTransport()
      fake.mjs              in-process pair: createFakePair() -> [a, b]; test-only but shipped
      websocket/
        package.json        "@atlas/transport-websocket", deps: ws
        index.mjs           wsClient(url), wsServer({port}) -> onConnection(transport)
    test/
      check.test.mjs
      build.test.mjs
      codec.test.mjs
      identity.test.mjs
      link.test.mjs
      calls.test.mjs
      asset-queue.test.mjs
      reconnect.test.mjs
      first-flight.test.mjs   in-process fake-transport run of examples/first-flight
      helpers/mini-core.mjs   tiny test Core built only on SDK calls (NOT the real Core)
```

Packaging note: adapters are "their own packages beside the SDK" (design
decision). For v1 keep `adapters/websocket/` as its own `package.json` in the same
repo, imported by relative path from tests. Do **not** add npm workspaces or
publishing unless the developer asks. `fake.mjs` stays inside the SDK because
every test needs it.

What to lift from `lib/protocol.mjs`: `loadProtocol`, `validate`, `messageFile`,
`kindsOf`. Import them. Do not fork them. If `validate` needs a change (for
example returning structured errors), change it in `lib/` and keep the viewer
tests green. Core's private Ajv loader is deleted later, in the Core adopt PR,
not here.

---

## 3. Public API (sketch signatures)

All exported from `sdk/src/index.mjs`.

### 3.1 Definitions and check

```js
/** Loads definitions/index.json + every listed file. Sync-at-startup is fine. */
export async function loadDefinitions(opts?: { dir?: string }): Promise<Defs>
// Defs = { version: string /* from variables/protocol_version.json examples[0] */,
//          index, schemas, ajv, types: Set<string>, kindsByType: Map<string,string[]> }

export function check(defs: Defs, msg: unknown):
  { ok: true,  file: string, kind?: string }
| { ok: false, errors: string[], file?: string }
```

Invariants:
- `check` is pure, never mutates `msg`, and never throws on bad input (`null`, an array, unknown `type` all return `ok:false`).
- An unknown `type` is `ok:false, errors:["unknown type <t>"]`.
- One rule a schema can't state is checked after the schema: in any object holding both, `semi_minor_m` is no larger than `semi_major_m` (an uncertainty ellipse). It is the only cross-field rule; add none without a decision.
- `defs.version` is read from the definitions. It is never a constant in SDK code.
- Bind a convenience `createSdk({defs})` that returns `{check: m => check(defs,m), build, ...}` so callers don't thread `defs`.

### 3.2 Build

```js
export function build(defs, identity, type: string, fields: object): Message
// Copies fields, sets type, then identity.stamp() fills from/seq/time
// (and keys only if type is admin.hello / admin.operator_hello), then check().
// Throws SdkError('invalid', errors) if check fails. Throws SdkError('auth_lost') if identity is stopped.
```

Invariants:
- Caller-supplied `from`/`seq`/`time` are **rejected** (throw). Only identity stamps them. Retries never rebuild: they resend the stored bytes (`retry`, section 3.7).
- Key order in the output follows law 3: `type, time, seq, from, asset_id?, kind?`, then the rest in caller order. `JSON.stringify` order is then deterministic.
- Numbers and left-out fields are kept exactly (concept 2): no defaults injected, no rounding.
- `seq` is consumed only when `build` succeeds (validate a draft first, then stamp). A failed build must not leave a gap.

### 3.3 Codec

```js
export const jsonCodec = { encode(msg): Uint8Array, decode(bytes): unknown }
```
One message per transport frame for WebSocket.

Raw bytes travel with every message. Inbound, the link hands callers an
`Inbound = { msg, raw: Uint8Array }` (`msg` is frozen). `link.forward(raw)` sends
those bytes unchanged, with no re-encode. That is how Core forwards byte-equal
(law: Core forwards other creators' messages unchanged). `send(msg)` is only for
messages this identity built; built messages keep their encoded bytes too, so a
retry resends exactly those bytes. Framing for byte streams
(Meshtastic/FLRC) is a later link profile. Leave a `codec` option on `createLink`
so it can be swapped. `decode` errors become a dropped message plus an observer
event `decode_error`. Never throw into the transport.

### 3.4 Transport interface (D5, bytes only)

```js
/** @typedef Transport
 *  open(): Promise<void>
 *  send(bytes: Uint8Array): void | Promise<void>
 *  onData(cb: (bytes: Uint8Array) => void): void
 *  onClose(cb: (info: {code?: number, reason?: string}) => void): void
 *  close(): void
 */
export function assertTransport(t): void
export function createFakePair(opts?: { latencyMs?, dropRate?, duplicateRate?, reorder? }): [Transport, Transport]
```
Invariants: adapters never see message objects, never parse JSON, and never retry.
`open()` on a server-accepted transport resolves immediately. `close()` is
idempotent and fires `onClose` once.

WebSocket adapter:
```js
export function wsClient(url: string): Transport
export function wsServer(opts: { port?: number, server?: http.Server }):
  { onConnection(cb: (t: Transport, req) => void), close(): Promise<void>, address() }
```
Binary frames only. Pass `Uint8Array` through.

### 3.5 Identity (D7)

```js
export function createIdentity(opts: {
  id: string,                  // asset_id | operator_id | 'CORE'
  role: 'asset' | 'operator' | 'core',
  key?: string, enrollmentKey?: string,
  seqStore?: { load(): number, save(n: number): void },  // Core persists; others default in-memory
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
- There is one seq counter per identity, shared across all links. It does not reset on reconnect. It may restart at 0 on a process restart only when `time` is strictly later.
- `time = max(now(), lastTime)`. It never goes backwards. If `now()` is earlier than `lastTime`, use `lastTime` (same ms is allowed; seq disambiguates).
- Dedupe key: `(from, seq, time)`. Dedupe decides whether a message is **acted on**, not whether it is delivered (section 3.6). Keep a per-`from` bounded ring (Map + array, size N, oldest evicted). Memory is bounded by `N × distinct from`. Add a cap on distinct `from` (default 4096, LRU).
- No Core-style last-answer cache in the SDK for forwarded traffic. That cache belongs to **Core** (business layer); the SDK exposes `seen()` and `onDuplicate` so Core can resend its cached reply.
- The Asset helpers are different: an Asset answers `control.settings` and `control.cancel` itself with `report.settings`, so the Asset queue helper keeps its own answer replay (section 3.9). It is Asset-side, bounded, and separate from Core's cache.
- Contact (communication.md, Losing the link): identity records `lastContact` (the `now()` of the last **non-duplicate** inbound message after an accepted hello whose `asset_id` is this identity's id and whose `from` is **not** this identity's id). Exposed as `identity.contact()` and an observer event `contact`. The Asset app sends `report.telemetry` early when it has sent nothing new for a third of its `link_loss_after_s`, so Core can count it connected; the SDK exposes when it last sent something new (communication.md, When Core counts an Asset offline). The SDK only reports contact; timing `link_loss_after_s` and triggering the `link_loss` failsafe is the Asset app's work (helpers never fly). A creator sends nothing until its clock is set: `build` throws `SdkError('clock_unset')` while `now()` returns null.

### 3.6 Link

```js
export function createLink(opts: {
  defs, identity, transport, codec?, observer?,
  side: 'client' | 'server',
  helloTimeoutMs?: number,      // default 10000
  describe?: object,            // Asset only: fields for admin.describe
  connectSettings?: () => object // Asset only: the settings object for the connect report.settings
}): Link

Link = {
  state: 'idle'|'opening'|'hello_sent'|'ready'|'closed'|'auth_lost'|'version_mismatch',
  open(): Promise<HelloResult>  // client: open transport, send hello, await admin.hello_reply
  accept(): Promise<PeerHello>  // server: await first message, must be a hello type
  replyHello(result, fields)    // server side (Core) answers
  send(msg): void               // a message this identity built; sends its stored bytes
  forward(raw: Uint8Array): void // byte-equal forwarding (Core); no decode/encode
  onMessage(cb: (inb: {msg, raw, duplicate: boolean}) => void): () => void  // after check; every delivery
  onState(cb): () => void
  close(): void
  peer: { id, role } | null
}
```
Hello state machine (client):
1. `open` → `hello_sent`: build `admin.hello` (asset) or `admin.operator_hello` (operator). `protocol_version = defs.version`.
2. Wait for `admin.hello_reply` (not `admin.reply`).
   - `accepted` → an Asset sends `admin.describe` (D9) and its connect `report.settings`, each acknowledged by Core's `admin.reply`, then → `ready` (section 3.10).
   - `version_mismatch` → state `version_mismatch`, close, and reject `open()` with `SdkError('version_mismatch', {peer: protocol_version})`. No retry loop (strict breaks are intended).
   - `refused` → `identity.stop('refused')`, state `auth_lost`, close. Network sends stop. Local reads stay.
   - timeout → close, `SdkError('timeout')`, eligible for reconnect.

Server side (used by mini-core in tests, later by Core): the first message must
be a hello type, or close. The SDK checks schema and version equality. **Key
verification is Core business** (it holds the hashes): `accept()` returns the hello,
and Core calls `replyHello`. One-link-per-ID replacement (law 22) is Core business
too; the SDK just provides `close()`.

Inbound pipeline, in this order: `decode → check → (pre-ready filter) → dup = identity.seen(msg) → identity.remember(msg) → dispatch`.
- Pre-ready filter: a server takes only a hello type first. A client takes only `admin.hello_reply` until its hello is accepted; then, until `ready`, an Asset client takes only `admin.reply` (Core's acknowledgements of its describe and connect report). Anything else before `ready` is dropped **before** it is remembered, so Core's resend of it is handled later.
- Remember **before** dispatch, so a throwing handler cannot leave the message unremembered and get it handled again.
- Act vs deliver (communication.md, Routing and duplicates): `dup` is passed to every consumer. Consumers that **act** (Asset queue, settings apply, Core business, contact) skip duplicates. Consumers that **read** (`stream` items, `subscribe`, live picture) still get them. History answers and Core's connect push are replays and must reach the reader.
- Invalid messages are dropped, with an observer event `invalid_in`. Never forward an invalid message.
- On a duplicate, also call `onDuplicate(inb)` (Core's last-answer resend; the Asset helper's answer replay). A duplicate **reply** (`admin.reply`, `report.settings` with reply fields) never resolves a pending entry twice.
- Outbound: `send` re-checks (cheap) unless the message came from `build` in this process (tag with a WeakSet).

### 3.7 Calls (D3)

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

### 3.8 Outcome and errors

```js
export const Outcome = { ACCEPTED: 'accepted', REJECTED: 'rejected', FAILED: 'failed', UNKNOWN: 'unknown' }
export class SdkError extends Error { code: 'invalid'|'auth_lost'|'version_mismatch'|'timeout'|'busy'|'closed'|'not_ready'|'clock_unset'; detail }
```
Rule: a protocol outcome is a **Result value**. Programmer errors and hard stops
are **throws**. `unknown` is never turned into failure. `accepted` never means
done (Task completion arrives via `subscribe({type:'report.status', kind:'task'})`).

Auth loss (concept 9): on a refused hello, call `identity.stop('refused')`. (A
dropped link is just a disconnect; if the keys were revoked, the next reconnect's
refused hello gives `auth_lost`.) Then every `build`/`request`/`send` throws
`SdkError('auth_lost')`, pending requests resolve `unknown/auth_lost`, reconnect
halts, and the observer gets `auth_lost`. Picture and queue state stay readable.

### 3.9 Asset queue helper (D6)

```js
export function createAssetQueue(opts: { link, identity, store?: TaskStore, now?, finalRetryMs?: number /*10000*/ }): AssetQueue
AssetQueue = {
  onTask(cb: (task: Message) => void): () => void  // emits in Core's order, at most once per task_id
  onImmediate(cb: (msg: Message) => void): () => void // immediate command/settings; control.cancel without task_id (stop motion now) and cancel of the running task
  next(): Message | null                           // head of list the Asset should run
  report(taskId, state: task_state, fields?)       // builds report.status kind task; finals kept for retry
  answer(request: Message, settings): Message      // builds report.settings with reply_from/reply_to; kept for replay
  queueReport(): Message                           // builds report.status kind queue with current task_ids
  clear(): void                                    // cancels every held task (each reported cancelled, then an empty queue report)
  ids(): string[]
}

TaskStore = Map-like { get(key), set(key, value), delete(key), keys() }  // default: new Map()
//   "task:<task_id>"          -> { final: Uint8Array, acked: boolean }  one record per finished task
//   "answer:<from:seq:time>"  -> Uint8Array                             the Asset's report.settings answer
// keys() is in insertion order; the helper keeps the newest >= 1024 of each prefix and deletes older ones.
```
A persistent store is anything with those four methods. All queue logic stays in
the helper.
Invariants (law 18, communication.md):
- A task is any `control.command` **or** `control.settings` carrying `task_id`.
- The order is arrival order of task bodies. That is Core's order, because Core sends a task only after the Asset has shown it holds the one before (law 18). The helper **never** waits on gaps and has no `task_seq`.
- Resent body for a task it **holds** (queued or running): ignored.
- Resent body for a task it has **finished**: nothing changes, and it resends that task's stored `final` bytes.
- When a task fails, or a failsafe triggers with any response except `continue`, the app calls `clear()`, sets `run_state` paused and reports it in `report.settings` (the app owns `run_state`, as for a cancel). A task that arrives afterwards is held like any other and waits while paused.
- A **motion** `control.command` without `task_id` runs now and clears the list. Each cleared task gets reported `cancelled`, then an empty queue report. A `control.settings` without `task_id` runs now beside the queue and does **not** clear it.
- `control.cancel` with `task_id`: a queued task is dropped and reported cancelled; the running one is emitted to `onImmediate` (don't fly anything, concept 10); a finished one changes nothing and its final report is resent; an unknown one is finished at once as `cancelled` (built, stored and retried like any final), so its body, if it arrives later, is a finished task: the cancelled report is resent and it never runs. In every case the queue reports the new list, and the cancel is answered.
- `control.cancel` **without** `task_id` stops the motion running now and is emitted to `onImmediate` (hold/pause); it never creates a task. The cancel is answered like any other.
- Every `control.cancel` and `control.settings` is answered with `report.settings` (`reply_from`/`reply_to` naming it). The helper builds the answer frame through `answer()`; the app supplies the `settings` object. The answer bytes are stored; a duplicate request (via `onDuplicate`) gets the same bytes again, unchanged. This is Asset-side answer replay, not Core's last-answer cache.
- Final reports (`completed|failed|cancelled`) are stored as `task:<task_id>` with `acked: false` until an `admin.reply` matches by `reply_from/reply_to` **and** `task_id`. Retry the **same bytes** on each new link and every 10 s (`finalRetryMs`) until acked, with no attempt cap. Observer event `final_report_retry` on each retry. With a persistent store, retries continue after an Asset restart.
- There is no queue cap and no "reject a task": the protocol gives an Asset no way to refuse one, so Core would resend forever. (Open question if a bound is ever needed.)
- After adding tasks, send `queueReport()`.

### 3.10 Reconnect (D8)

```js
export function createReconnector(link factory, opts: { backoff?: {minMs:500,maxMs:30000,factor:2,jitter:0.2} })
```
- Reconnect on transport close or hello timeout. Stop on `auth_lost` and `version_mismatch`.
- **Asset**, after **every** accepted hello (first connect and each reconnect), in order (communication.md, After reconnecting): the link sends (1) `admin.describe` from `opts.describe` and (2) the connect `report.settings` from `opts.connectSettings()` (every setting it supports; Core refuses changes to any setting it leaves out). It sends each only after the one before is acknowledged by Core's `admin.reply` (matched by `reply_from`/`reply_to`), resending the same bytes every 10 s until then (law 23), then sets state `ready`. The Asset queue listens with `onState` and on `ready` sends (3) unacked final reports, (4) `queueReport()`, (5) `query.queue`. The reconnector only reopens the link and has no resync steps of its own; `link.mjs` never imports `asset-queue.mjs`.
- **Operator**: pending → `unknown/disconnected`. No command retry. The live picture (if on) goes `stale:true` and then rebuilds from Core's connect push. Those messages are mostly duplicates of what it saw before; they are delivered anyway (section 3.6).
- The seq counter continues across reconnects (same identity object).

### 3.11 Optional observer

```js
createLink({ observer: (event: { name, at, ...detail }) => void })
```
Events: `open, hello_sent, ready, closed, reconnect_scheduled, invalid_in, invalid_out, duplicate_in, decode_error, timeout, late_reply, auth_lost, version_mismatch, final_report_retry, contact`.
Emit through `queueMicrotask` inside try/catch.
Observer exceptions are swallowed and an async observer's promise is never awaited.
JS is single-threaded, so an observer that blocks synchronously still blocks; that
is the caller's bug and is not tested. Only one observer per link.

### 3.12 Optional live picture (D4, slice 9)

```js
export function createLivePicture(link): Picture
Picture = {
  ready: boolean, stale: boolean,
  assets(): { ready, stale, items: Map<asset_id, { describe?, latest: Map<type#kind, Message> }> },
  tasks(assetId?): { ready, stale, items },
  onChange(cb): () => void
}
```
- `ready=false` until the picture's own `query.core kind assets` request gets its `admin.reply` (decided, P2 in section 10). No protocol change.
- Upsert by `(from, seq, time)`. When a value for the same slot (asset + type#kind) is replaced, the newest `time` wins. Duplicates are delivered, so a replay refills the picture.
- On disconnect, `stale=true` and data is kept. On reconnect, rebuild from scratch (no disk).
- Reads return `{ready, stale, items}` and never a bare empty list.
- Assets do not need it.

### 3.13 Names the SDK may hardcode

These are the only message types the SDK may name: `admin.hello`,
`admin.operator_hello`, `admin.hello_reply`, `admin.describe`, `admin.reply`,
`report.settings` (reply matching), `report.status` kinds `task`/`queue`,
`control.command`, `control.settings`, `control.cancel`, `query.queue`, and, for
stream matching only (section 3.7), `query.core` kinds `history`/`assets`/`plugins`,
`query.asset`, `plugin.call`, `plugin.result` and `plugin.describe`. Everything
else (commands, reports, other query kinds) flows through generic `build`/`check` and
must need **zero** SDK code. Add a test that builds an example of every type and
kind in `definitions/` through `build` with no per-type branches.

---

## 4. Definitions loading (no codegen)

- `loadDefinitions({dir})` defaults to `new URL('../../definitions/', import.meta.url)`, reads `index.json`, then every file listed (the same as `loadProtocol` with an fs `readJson`).
- Ajv: `new Ajv({strict:false, allErrors:true})` + `ajv-formats`, as in lib. Compile lazily per `$id`, then memoize.
- Type → file: `messageFile(msg)` (`control.command` → `messages/control/command.json`). Validate the whole message against that type schema, including its `oneOf`. A kind schema alone does not check the common fields or reject extra fields. An unknown `kind` gets one error naming the allowed kinds; error formatting must not skip full-message validation. `check` reports `kind` when present.
- `defs.version`: `schemas['variables/protocol_version.json'].examples[0]`.
- A test asserts every file under `definitions/` is listed in `index.json`, and that the SDK loads it all in under 500 ms.
- Changing a JSON definition changes SDK behavior with no rebuild step. That is the point.

---

## 5. Build slices (one PR each)

Every PR updates the `sdk/README.md` status line and runs `npm run check` + `npm test`.

### Slice 1: Definitions, `check`, `build`, codec, clock
Files: `package.json`, `definitions.mjs`, `check.mjs`, `build.mjs`, `codec.mjs`, `clock.mjs`, a minimal `identity.mjs` (stamp + seq only), `outcome.mjs`, `index.mjs`.
Acceptance:
- Every example in every definition (`examples[]`) passes `check`. Every file in `examples/first-flight` and `examples/operator-session` passes.
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
- Replay `examples/first-flight/scenario.json` (sim Asset A1 + operator OP1 + mini-core over fake transports, with duplicate and reorder knobs on).
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
Write `sdk/core-adopt.md` (short). It is the checklist for a **later**,
separate Core PR, not done here:
- Replace Core's Ajv loader with `check`. Replace the socket code with `wsServer` + `createLink({side:'server'})`.
- Core identity is `createIdentity({id:'CORE', role:'core', seqStore: <persisted>})`.
- Delete seq renumbering, `admin.asset`, the `task_seq` pass-through and the second dedupe set. Keep a last-answer cache keyed `(from,seq,time)` and wire it to `onDuplicate`.
- Forward with `link.forward(raw)` (byte-equal). Send `admin.alive` when Core has sent an Asset nothing new for a third of its `link_loss_after_s`.- Business rules that stay in Core: key hash check, one-link-per-ID replace, online check (contact, not an open link), stop resending Tasks once an Asset goes offline and mark each Task it gave up `undelivered`, command listed in describe, `task_id` duplicate, ready (send an Asset no Task and pass nothing on to it, refusing operator `control.*`, until Core has acknowledged its connect report), ordered task list (send a task only after the Asset shows it holds the one before; drop unsent tasks when the Asset reports a task cancelled that Core passed on no cancel for, or goes offline; on passing on a motion command without `task_id`, drop unsent tasks and cancel each sent one the Asset has not shown it holds), `every_s` repeats (a new Core-created message each time, with a new seq).
- Pin Core to the protocol release tag that contains the SDK.

---

## 6. Data structures (ownership)

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

## 7. Test strategy

- Unit tests per module (sections above), all on the fake clock and fake transport. Deterministic: seeded RNG and no real timers (use `node:test` mock timers or injected `setTimeout`).
- One integration test: slice 9 first-flight over the fake pair, clean and lossy.
- One WS smoke test on localhost (slice 2). Optionally rerun slice 9 over WS.
- The generic-type test (every definition example through `build`/`check` with no per-type code) guards "new message = zero SDK code."
- Protocol's existing `scenarios.test.mjs` keeps passing. Add SDK tests to the `npm test` glob (`test/*.test.mjs sdk/test/*.test.mjs`).
- No test hits the internet.

---

## 8. Not now

- Fusion and track messages (no wire types exist). Fetching an Object's file. Geo feature and Object messages go through the generic front door with no SDK code.
- Meshtastic and FLRC adapters. The interface exists; write no implementation and no framing profile.
- Byte-stream framing, compression and chunking (link profile work, law 12).
- Rewriting or adapting Core (only `core-adopt.md` notes). No Core submodule bump.
- Disk cache for the picture. Browser builds. npm publishing or workspaces.
- Auto-retry of operator commands. Any `task_seq` or gap-wait. A Core-style last-answer cache in the SDK (the Asset helper's own answer replay is in scope).
- Generated clients, TypeScript, OpenAPI.
- New protocol fields or laws. If a slice seems to need one, stop and raise it.

---

## 9. Invariants checklist (each PR)

- [ ] No message type named outside the section 3.13 allow-list.
- [ ] `from/seq/time` stamped only by identity. Keys only on hello types.
- [ ] Forwarding never changes bytes (`forward(raw)`).
- [ ] Dedupe gates acting, never delivery to readers.
- [ ] `unknown` never mapped to failure. Disconnect never rejects a promise.
- [ ] Every queue, map and buffer has a bound.
- [ ] Observer errors are swallowed.
- [ ] No `Date.now()` outside `clock.mjs`. No network in tests except localhost WS.

---

## 10. Decided implementation points

Confirmed by the developer. These are settled; do not reopen them in a slice PR.

- **Dedupe (all slices):** act once, deliver always. Dedupe stops a message being acted on again; streams, subscribers and the picture still receive replays. The picture upserts by `(from, seq, time)`, newest `time` wins.
- **Contact (slice 4):** `lastContact` / `contact()` advances on non-duplicate post-hello inbound with `asset_id === this id && from !== this id` (not only `from: CORE`).
- **Streams (slice 5, replaces P1):** a stream's items are the inbound messages that match its query's fields, once per `(from, seq, time)`, until its reply (section 3.7). No interleave rule and no one-stream-per-link limit. Core sends a history answer oldest first; the finished result is sorted by `time`.
- **Subscribe (slice 5):** callback is `{msg, raw, duplicate}` (same as `onMessage`); acting code skips duplicates.
- **P2 (slice 9):** the live picture issues its own `query.core kind assets` on connect and reconnect, and is `ready` when that request's `admin.reply` arrives. It does not try to detect the end of Core's connect push.
- **P3 (slice 2):** each transport adapter is a sibling package with its own `package.json`. No npm workspaces.
- **P4 (slice 6):** the Asset queue takes a Map-like store (`get`/`set`/`delete`/`keys`, default `new Map()`), section 3.9. One record per finished task (final bytes + `acked`) and one per answer, newest ≥1024 of each kept. A cancel before arrival is a finished task whose final is `cancelled`.
- **Post-hello sequence (slices 3/6):** after every accepted hello, including the first, the link sends describe → connect `report.settings`, each waiting for Core's `admin.reply`, and then sets `ready`; the Asset queue's `ready` listener sends unacked finals → queue report → `query.queue`. `createLink` takes `connectSettings`.

## 11. How to work this plan

- One slice per PR, in order. Each PR passes its acceptance tests and the section 9 checklist.
- Do not start the next slice before the previous one is merged.
