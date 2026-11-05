# Atlas SDK implementation plan (protocol 0.8)

For a coding agent building the SDK runtime in `protocol/sdk/`. The behavior
contract is already locked in `sdk/how-it-works.md`, `sdk/concepts.md`,
`docs/laws.md` and `docs/communication.md`. This file covers **how to build it**:
the file layout, signatures, invariants, the order of PRs, and tests. If this
plan and those docs disagree, the docs win. Stop and ask; do not invent a fix.

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
| Runtime | Node **>= 22.13** (matches Core `engines`; box has 24.x). Add `"engines": {"node": ">=22.13"}` to the SDK package. |
| Modules | ESM only (`"type": "module"`), `.mjs` files. |
| Tests | `node --test`; no Jest or Mocha. Add `sdk/test/*.test.mjs` to protocol's `npm test` glob. |
| Deps | SDK: `ajv`, `ajv-formats` (already in protocol). WebSocket adapter: `ws` (Core already uses `^8.18`). Nothing else without asking. |
| Network | No CDN, no remote `$ref` fetch, no network at load time. Definitions are read from disk. |
| Browser | Not a v1 target for the SDK runtime. The viewer keeps using `lib/protocol.mjs`. Keep `src/` free of `fs` except in `definitions.mjs`, so browser support stays possible later. |
| Clock | `now()` is injectable everywhere (tests use a fake clock). Never call `Date.now()` directly outside `clock.mjs`. |
| Commits | Author **and** committer: `the-Drunken-coder <183743141+the-Drunken-coder@users.noreply.github.com>`. Set `git config user.name/user.email` in the clone. |
| Privacy | Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. Use IDs like `A1`, `OP1`, `CORE`. |
| Process | One PR per slice below. Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval. Do not hand-edit versions (`npm run bump` only). Do not touch Core in these PRs. |

---

## 2. Layout

```text
protocol/
  lib/protocol.mjs          KEEP. Viewer and CLI use it. The SDK imports loadProtocol/validate/messageFile from here.
  sdk/
    README.md               update the status line and layout per slice
    how-it-works.md         locked contract (do not edit unless the developer changes a lock)
    concepts.md             locked
    IMPLEMENTATION.md       this plan
    package.json            name "@atlas/sdk", private, type module, exports "./src/index.mjs"
    src/
      index.mjs             public exports only
      definitions.mjs       loadDefinitions(): reads ../../definitions from disk, wraps lib loadProtocol
      check.mjs             check(msg) -> {ok, errors, file, kind}
      build.mjs             build(type, fields, {identity}) -> stamped, checked message
      codec.mjs             encode(msg) -> Uint8Array; decode(bytes) -> msg  (JSON + UTF-8; framing hook)
      clock.mjs             now() default and makeClock(); monotonic guard
      identity.mjs          createIdentity(): keys, stamping, seq counter, dedupe window, auth state
      dedupe.mjs            DedupeWindow (per-from ring of (seq,time)), used by identity
      link.mjs              createLink(): transport + codec + identity + hello state machine + dispatch
      calls.mjs             request / stream / subscribe on top of link
      outcome.mjs           Outcome constants and the SdkError class
      asset-queue.mjs       createAssetQueue(): task_id list, ran-set, final-report retries
      reconnect.mjs         backoff policy and the Asset auto-resync sequence
      picture.mjs           OPTIONAL createLivePicture() (slice 8)
      observer.mjs          OPTIONAL observer plumbing (safe emit)
      errors.mjs            (merge into outcome.mjs if small)
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
- Caller-supplied `from`/`seq`/`time` are **rejected** (throw). Only identity stamps them. The one exception is `rebuildRetry(msg)`, which returns the identical stored bytes.
- Key order in the output follows law 3: `type, time, seq, from, asset_id?, kind?`, then the rest in caller order. `JSON.stringify` order is then deterministic.
- Numbers and left-out fields are kept exactly (concept 2): no defaults injected, no rounding.
- `seq` is consumed only when `build` succeeds (validate a draft first, then stamp). A failed build must not leave a gap.

### 3.3 Codec

```js
export const jsonCodec = { encode(msg): Uint8Array, decode(bytes): unknown }
```
One message per transport frame for WebSocket. Framing for byte streams
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
- Dedupe key: `(from, seq, time)`. Keep a per-`from` bounded ring (Map + array, size N, oldest evicted). Memory is bounded by `N × distinct from`. Add a cap on distinct `from` (default 4096, LRU).
- The SDK does **not** cache answers. The last-answer cache belongs to **Core** (business layer). The SDK only exposes `seen()` so Core can choose to resend its cached reply.

### 3.6 Link

```js
export function createLink(opts: {
  defs, identity, transport, codec?, observer?,
  side: 'client' | 'server',
  helloTimeoutMs?: number,      // default 10000
  describe?: object             // Asset only: fields for admin.describe, sent after accepted hello
}): Link

Link = {
  state: 'idle'|'opening'|'hello_sent'|'ready'|'closed'|'auth_lost'|'version_mismatch',
  open(): Promise<HelloResult>  // client: open transport, send hello, await admin.hello_reply
  accept(): Promise<PeerHello>  // server: await first message, must be a hello type
  replyHello(result, fields)    // server side (Core) answers
  send(msg): void               // raw, already built; diagnostics + calls.mjs
  onMessage(cb): () => void     // after check + dedupe; raw
  onState(cb): () => void
  close(): void
  peer: { id, role } | null
}
```
Hello state machine (client):
1. `open` → `hello_sent`: build `admin.hello` (asset) or `admin.operator_hello` (operator). `protocol_version = defs.version`.
2. Wait for `admin.hello_reply` (not `admin.reply`).
   - `accepted` → `ready`. An Asset then sends `admin.describe` from `opts.describe` automatically (D9).
   - `version_mismatch` → state `version_mismatch`, close, and reject `open()` with `SdkError('version_mismatch', {peer: protocol_version})`. No retry loop (strict breaks are intended).
   - `refused` → `identity.stop('refused')`, state `auth_lost`, close. Network sends stop. Local reads stay.
   - timeout → close, `SdkError('timeout')`, eligible for reconnect.

Server side (used by mini-core in tests, later by Core): the first message must
be a hello type, or close. The SDK checks schema and version equality. **Key
verification is Core business** (it holds the hashes): `accept()` returns the hello,
and Core calls `replyHello`. One-link-per-ID replacement (law 22) is Core business
too; the SDK just provides `close()`.

Inbound pipeline, in this order: `decode → check → (pre-ready: only hello types allowed) → identity.seen? → dispatch → identity.remember`.
- Invalid messages are dropped, with an observer event `invalid_in`. Never forward an invalid message.
- On a duplicate, call `onDuplicate(msg)` (a hook for Core's last-answer resend). Calls do not see it again.
- Outbound: `send` re-checks (cheap) unless the message came from `build` in this process (tag with a WeakSet).

### 3.7 Calls (D3)

```js
export function request(link, msg, opts?: { timeoutMs?: number /*default 10000*/, signal?: AbortSignal }):
  Promise<Result>
export function stream(link, msg, opts?: { timeoutMs?, maxItems?: number /*default 10000*/, signal? }):
  AsyncIterable<Message> & { result: Promise<Result> }
export function subscribe(link, filter: { type?: string|string[], kind?: string|string[],
  asset_id?: string, from?: string } | ((m) => boolean), cb: (m) => void): () => void  // unsubscribe

Result =
  { outcome: 'accepted', reply: Message, items?: Message[] }
| { outcome: 'rejected', reply: Message, explanation: string }
| { outcome: 'unknown', reason: 'timeout' | 'disconnected' | 'aborted' | 'auth_lost' }
```
Matching: a reply matches a pending entry when `reply.reply_from === msg.from && reply.reply_to === msg.seq`.
Reply types that close a pending entry: `admin.reply`, and `report.settings` when
it carries `reply_from`/`reply_to`. Map `reply_result: 'refused'` to `rejected`.

`stream`: between send and the matching reply, items count as answers when they
arrive on that link and match the request's selector. For `query.core`, Core
sends stored messages unchanged, so the SDK cannot tie them by reply fields.
Rule: while a stream is open, inbound messages that are not replies go to the
stream **and** to subscribers. Only one `query.core` stream may be open per link
at a time (queue others FIFO). That keeps attribution unambiguous without a new
protocol field (decided, P1 in section 10).

Pending-request table, per link: `Map<seq, {msg, resolve, timer, kind:'request'|'stream', items[]}>`.
The key is just `seq`, because `from` is always this identity.
- On disconnect, resolve every pending entry `unknown/disconnected`. Never reject.
- On timeout, resolve `unknown/timeout`. A late reply after timeout goes to an observer event `late_reply` and is otherwise ignored.
- Never auto-retry. `retry(result)` is an explicit helper: it resends the **same** stored bytes (same from/seq/time) and is allowed for any message. Docs say not to retry non-idempotent commands automatically; a manual retry of the same bytes is safe because of dedupe plus Core's last-answer cache.
- Bounded: `maxPending` per link (default 256). Over the cap, `request` throws `SdkError('busy')`.

### 3.8 Outcome and errors

```js
export const Outcome = { ACCEPTED: 'accepted', REJECTED: 'rejected', UNKNOWN: 'unknown' }
export class SdkError extends Error { code: 'invalid'|'auth_lost'|'version_mismatch'|'timeout'|'busy'|'closed'|'not_ready'; detail }
```
Rule: a protocol outcome is a **Result value**. Programmer errors and hard stops
are **throws**. `unknown` is never turned into failure. `accepted` never means
done (Task completion arrives via `subscribe({type:'report.status', kind:'task'})`).

Auth loss (concept 9): on a refused hello, or a link closed by Core with an auth
reason, call `identity.stop(reason)`. Then every `build`/`request`/`send` throws
`SdkError('auth_lost')`, pending requests resolve `unknown/auth_lost`, reconnect
halts, and the observer gets `auth_lost`. Picture and queue state stay readable.

### 3.9 Asset queue helper (D6)

```js
export function createAssetQueue(opts: { link, identity, store?: QueueStore }): AssetQueue
AssetQueue = {
  onTask(cb: (task: Message) => void): () => void  // emits in Core's order, at most once per task_id
  next(): Message | null                           // head of list the Asset should run
  report(taskId, state: task_state, fields?)       // builds report.status kind task; final states tracked for retry
  queueReport(): Message                           // builds report.status kind queue with current task_ids
  ids(): string[]
}
```
Invariants (law 18):
- `ran: Set<task_id>` is persistent if a store is given. A `task_id` already in `ran` or in the list is **never** enqueued twice. A resent body is ignored.
- The order is arrival order of task bodies (Core sends in its list order, once). The helper **never** waits on gaps and has no `task_seq`.
- A `control.command` **without** `task_id` clears the list. Each cleared task gets reported `cancelled`, then an empty queue report (per the command description). The helper emits the immediate command to the app.
- `control.cancel` with `task_id` drops a queued task. The running one is the app's business (emit the event; don't fly anything, concept 10).
- Final reports (`completed|failed|cancelled`) go into `unacked: Map<key(from,seq), msg>` until an `admin.reply` matches by `reply_from/reply_to` + `task_id`. Retry the **same bytes** on reconnect and every `finalRetryMs` (default 5000, capped attempts, then observer `final_report_stuck`).
- After adding tasks, send `queueReport()`.

### 3.10 Reconnect (D8)

```js
export function createReconnector(link factory, opts: { backoff?: {minMs:500,maxMs:30000,factor:2,jitter:0.2} })
```
- Reconnect on transport close or hello timeout. Stop on `auth_lost` and `version_mismatch`.
- **Asset**, on each accepted hello, in order: (1) `admin.describe`, (2) resend unacked final reports, (3) `queueReport()`, (4) `query.queue`.
- **Operator**: pending → `unknown/disconnected`. No command retry. The live picture (if on) goes `stale:true` and then rebuilds from Core's connect push.
- The seq counter continues across reconnects (same identity object).

### 3.11 Optional observer

```js
createLink({ observer: (event: { name, at, ...detail }) => void })
```
Events: `open, hello_sent, ready, closed, reconnect_scheduled, invalid_in, invalid_out, duplicate_in, decode_error, timeout, late_reply, auth_lost, version_mismatch, final_report_retry, final_report_stuck`.
Emit through `queueMicrotask` inside try/catch. Observer exceptions are swallowed,
and a slow observer cannot block the pipeline. Only one observer per link.

### 3.12 Optional live picture (D4, slice 8)

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
- On disconnect, `stale=true` and data is kept. On reconnect, rebuild from scratch (no disk).
- Reads return `{ready, stale, items}` and never a bare empty list.
- Assets do not need it.

### 3.13 Names the SDK may hardcode

These are the only message types the SDK may name: `admin.hello`,
`admin.operator_hello`, `admin.hello_reply`, `admin.describe`, `admin.reply`,
`report.settings` (reply matching), `report.status` kinds `task`/`queue`,
`control.command`, `control.settings`, `control.cancel`, `query.queue`. Everything
else (commands, reports, query kinds) flows through generic `build`/`check` and
must need **zero** SDK code. Add a test that builds an example of every type and
kind in `definitions/` through `build` with no per-type branches.

---

## 4. Definitions loading (no codegen)

- `loadDefinitions({dir})` defaults to `new URL('../../definitions/', import.meta.url)`, reads `index.json`, then every file listed (the same as `loadProtocol` with an fs `readJson`).
- Ajv: `new Ajv({strict:false, allErrors:true})` + `ajv-formats`, as in lib. Compile lazily per `$id`, then memoize.
- Type → file: `messageFile(msg)` (`control.command` → `messages/control/command.json`). Kinds are validated by the schema's `oneOf`. `check` reports `kind` when present.
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
- Mutations fail with a useful path: extra field, missing `from`, bad `kind`, key on `admin.describe`, `from` longer than 4 chars.
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
Files: `link.mjs`, full inbound pipeline, observer basics.
Acceptance (fake transport plus a test server built from `createLink({side:'server'})`):
- Asset hello accepted → `ready` → `admin.describe` sent automatically, carrying no key and no version.
- Operator hello accepted → `ready`, with no describe.
- A message before the hello is accepted is refused locally (`not_ready`). A server receiving a non-hello first closes.
- `version_mismatch` → `open()` rejects, state set, no reconnect.
- `refused` → `auth_lost`, after which `build` throws `auth_lost`.
- Invalid inbound bytes are dropped with an observer event, and the link survives.

### Slice 4: Identity dedupe (D1/D7)
Files: `identity.mjs` (full), `dedupe.mjs`.
Acceptance:
- A duplicate `(from,seq,time)` is delivered once. The same seq with a different time is delivered (restart case).
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
- `subscribe` filters by type, kind and asset_id. Unsubscribe stops delivery. A throwing subscriber does not break others.
- Bounded: `maxPending` gives `busy`. `AbortSignal` works.
- `control.settings` resolves on `report.settings` with reply fields.

### Slice 6: Asset queue helper (D6)
Files: `asset-queue.mjs`.
Acceptance:
- T1, T2, T3 bodies give run order T1, T2, T3. A duplicate T2 body is ignored. T1+T3 with T2 missing runs T1, T3 and does **not** wait (Core resends; order is Core's job).
- A `task_id` in `ran` is never emitted again, including after a simulated restart with a store.
- A command without `task_id` cancels the queue, reports each task cancelled, then sends an empty queue report.
- A final report is retried with identical bytes until a matching `admin.reply` (+ `task_id`) arrives, then stops.

### Slice 7: Reconnect (D8)
Files: `reconnect.mjs`.
Acceptance:
- Asset: drop the transport mid-task. On the next accepted hello, the order on the wire is describe → unacked final reports → queue report → `query.queue`.
- Operator: an in-flight request resolves `unknown/disconnected`. A command is **not** resent after reconnect.
- Backoff grows and is capped. No reconnect after `auth_lost` or `version_mismatch`.
- Seq stays continuous across reconnects.

### Slice 8: Optional live picture + observer polish (D4)
Files: `picture.mjs`, `observer.mjs`.
Acceptance: reads return `ready:false` while loading. After the connect push,
`ready:true`. On disconnect, `stale:true` with data still readable. On reconnect,
a full rebuild. Auth loss leaves a read-only snapshot. A throwing or slow
observer does not affect message flow (measure: 1000 msgs, observer sleeping
inside does not delay).

### Slice 9: First-flight path, end to end in-process
Files: `test/first-flight.test.mjs`, `test/helpers/mini-core.mjs`.
`mini-core` is a ~150-line test double built **only** from SDK calls (server
links, `check`, dedupe hook, a last-answer Map, an ordered task list, forward
unchanged). It proves that Core can be written on the SDK. It is **not** the real
Core and does not ship. Acceptance:
- Replay `examples/first-flight/scenario.json` (sim Asset A1 + operator OP1 + mini-core over fake transports, with duplicate and reorder knobs on).
- Forwarded messages arrive with the same `from/seq/time` (byte-equal), so nothing is renumbered.
- The operator gets one `admin.reply` per message. A retried command gets the same reply bytes (last-answer cache in mini-core).
- The Asset runs takeoff → move_to → land once each. Final reports are acked. A mid-run link loss recovers via slice 7.
- Repeat the run with 10% drop and 10% duplicate (seeded): still exactly-once task execution.

### Slice 10 (docs only): Core-as-caller notes
Write `sdk/core-adopt.md` (short). It is the checklist for a **later**,
separate Core PR, not done here:
- Replace Core's Ajv loader with `check`. Replace the socket code with `wsServer` + `createLink({side:'server'})`.
- Core identity is `createIdentity({id:'CORE', role:'core', seqStore: <persisted>})`.
- Delete seq renumbering, `admin.asset`, the `task_seq` pass-through and the second dedupe set. Keep a last-answer cache keyed `(from,seq,time)` and wire it to `onDuplicate`.
- Business rules that stay in Core: key hash check, one-link-per-ID replace, online check, command listed in describe, `task_id` duplicate, ordered task list, `every_s` repeats (a new Core-created message each time, with a new seq).
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
| asset task list / ran set | AssetQueue (SDK, Asset side) | `string[]`, injectable ran-store (in-memory `Set<string>` default) | queue cap 256, then reject + observer |
| unacked final reports | AssetQueue (SDK) | `Map<"from:seq", bytes>` | same cap |
| **last-answer cache** | **Core (not SDK)** | `Map<"from:seq:time", replyBytes>` | Core's choice |
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

- Fusion, tracks, objects or geo-feature messages and any SDK support for them (no wire types exist).
- Meshtastic and FLRC adapters. The interface exists; write no implementation and no framing profile.
- Byte-stream framing, compression and chunking (link profile work, law 12).
- Rewriting or adapting Core (only `core-adopt.md` notes). No Core submodule bump.
- Disk cache for the picture. Browser builds. npm publishing or workspaces.
- Auto-retry of operator commands. Any `task_seq` or gap-wait. Any SDK last-answer cache.
- Generated clients, TypeScript, OpenAPI.
- New protocol fields or laws. If a slice seems to need one, stop and raise it.

---

## 9. Invariants checklist (each PR)

- [ ] No message type named outside the section 3.13 allow-list.
- [ ] `from/seq/time` stamped only by identity. Keys only on hello types.
- [ ] Forwarding never changes bytes.
- [ ] `unknown` never mapped to failure. Disconnect never rejects a promise.
- [ ] Every queue, map and buffer has a bound.
- [ ] Observer errors are swallowed.
- [ ] No `Date.now()` outside `clock.mjs`. No network in tests except localhost WS.
- [ ] Commit identity is the-Drunken-coder noreply. No personal names or emails anywhere.

---

## 10. Decided implementation points

Confirmed by the developer. These are settled; do not reopen them in a slice PR.

- **P1 (slice 5):** one open `query.core` stream per link. Further `query.core` requests on that link queue FIFO until the open one gets its `admin.reply`.
- **P2 (slice 8):** the live picture issues its own `query.core kind assets` on connect and reconnect, and is `ready` when that request's `admin.reply` arrives. It does not try to detect the end of Core's connect push.
- **P3 (slice 2):** each transport adapter is a sibling package with its own `package.json`. No npm workspaces.
- **P4 (slice 6):** the Asset queue takes an injectable ran-store (`has(task_id)`, `add(task_id)`); the default is in-memory.

## 11. How to work this plan

- One slice per PR, in order. Each PR passes its acceptance tests and the section 9 checklist.
- The developer approves each merge. Do not merge your own slice PR or start the next slice before the previous one is merged.
