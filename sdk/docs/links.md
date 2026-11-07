# Links

How the SDK opens a link, moves bytes, reads what arrives, and reconnects. The wire
rules are in [Communication](../../protocol/docs/communication.md).

## Transport adapters (D5)

Bytes only:

```text
open / send(bytes) / onData(bytes) / onClose / close
```

Framing, JSON, and compression stay in the SDK or the link profile. Adapters do
not send or receive message objects.

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

## Link

```js
export function createLink(opts: {
  defs, identity, transport, codec?, observer?,
  side: 'client' | 'server',
  helloTimeoutMs?: number,      // default 10000
  describe?: object,            // Asset only: fields for admin.describe
  connectSettings?: () => object // Asset only: the settings object for the connect report.settings
}): Link

Link = {
  state: 'idle'|'opening'|'hello_sent'|'ready'|'closed'|'auth_lost',
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
1. `open` → `hello_sent`: build `admin.hello` (asset) or `admin.operator_hello` (operator), carrying the identity and keys.
2. Wait for `admin.hello_reply` (not `admin.reply`).
   - `accepted` → an Asset sends `admin.describe` (D9) and its connect `report.settings`, each acknowledged by Core's `admin.reply`, then → `ready` ([Reconnect](#reconnect-d8)).
   - `refused` → `identity.stop('refused')`, state `auth_lost`, close. Network sends stop. Local reads stay.
   - timeout → close, `SdkError('timeout')`, eligible for reconnect.

Server side (used by mini-core in tests, later by Core): the first message must
be a hello type, or close. The SDK checks the message against its loaded definitions. **Key
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

## Reconnect (D8)

- **Asset:** on every accepted hello, the SDK runs the
  [After reconnecting](../../protocol/docs/communication.md#after-reconnecting-asset) steps
  itself, without waiting for the program.
- **Operator:** an inflight `request` across a drop becomes `unknown`. The SDK
  does not auto-retry operator commands. The live picture rebuilds as in
  [Live picture](live-picture.md).

```js
export function createReconnector(link factory, opts: { backoff?: {minMs:500,maxMs:30000,factor:2,jitter:0.2} })
```
- Reconnect on transport close or hello timeout. Stop on `auth_lost`.
- **Asset**, after **every** accepted hello (first connect and each reconnect), in order (communication.md, After reconnecting): the link sends (1) `admin.describe` from `opts.describe` and (2) the connect `report.settings` from `opts.connectSettings()` (every setting it supports; Core refuses changes to any setting it leaves out). It sends each only after the one before is acknowledged by Core's `admin.reply` (matched by `reply_from`/`reply_to`), resending the same bytes every 10 s until then (law 23), then sets state `ready`. The Asset queue listens with `onState` and on `ready` sends (3) unacked final reports, (4) `queueReport()`. The reconnector only reopens the link and has no resync steps of its own; `link.mjs` never imports `asset-queue.mjs`.
- **Operator**: pending → `unknown/disconnected`. No command retry. The live picture (if on) goes `stale:true` and then rebuilds from Core's connect push. Those messages are mostly duplicates of what it saw before; they are delivered anyway ([Link](#link)).
- The seq counter continues across reconnects (same identity object).

## Observer (optional)

The observer delivers the SDK's [diagnostic events](logging.md) to its host.
It is optional for a general library caller; Core and Asset apps attach a
diagnostic consumer to collect their required run evidence.

```js
createLink({ observer: (event: { name, at, ...detail }) => void })
```
[SDK logging](logging.md) owns event coverage and the proposed record contents.
[SDK configuration](../config.md) tracks the controls still to be decided.
Emit through `queueMicrotask` inside try/catch.
Observer exceptions are swallowed and an async observer's promise is never awaited.
JS is single-threaded, so an observer that blocks synchronously still blocks; that
is the caller's bug and is not tested. Only one observer per link.
