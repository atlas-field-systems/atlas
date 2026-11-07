# Messages

How the SDK loads Protocol's definitions and builds, checks, encodes and decodes
messages. Nothing is generated: changing a JSON definition changes SDK behavior
with no rebuild step.

## Definitions and check

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

Loading (no codegen):
- `loadDefinitions({dir})` defaults to `new URL('../../protocol/definitions/', import.meta.url)`, reads `index.json`, then every file listed (the same as `loadProtocol` with an fs `readJson`).
- Ajv: `new Ajv({strict:false, allErrors:true})` + `ajv-formats`, as in lib. Compile lazily per `$id`, then memoize.
- Type → file: `messageFile(msg)` (`control.command` → `messages/control/command.json`). Validate the whole message against that type schema, including its `oneOf`. A kind schema alone does not check the common fields or reject extra fields. An unknown `kind` gets one error naming the allowed kinds; error formatting must not skip full-message validation. `check` reports `kind` when present.
- `defs.version`: `schemas['variables/protocol_version.json'].examples[0]`.
- A test asserts every file under `protocol/definitions/` is listed in `index.json`, and that the SDK loads it all in under 500 ms.

## Build

```js
export function build(defs, identity, type: string, fields: object): Message
// Copies fields, sets type, then identity.stamp() fills from/seq/time
// (and keys only if type is admin.hello / admin.operator_hello), then check().
// Throws SdkError('invalid', errors) if check fails. Throws SdkError('auth_lost') if identity is stopped.
```

Invariants:
- Caller-supplied `from`/`seq`/`time` are **rejected** (throw). Only identity stamps them. Retries never rebuild: they resend the stored bytes (`retry`, in [Calls](calls.md#module-callsmjs)).
- Key order in the output follows law 3: `type, time, seq, from, asset_id?, kind?`, then the rest in caller order. `JSON.stringify` order is then deterministic.
- Numbers and left-out fields are kept exactly (concept 2): no defaults injected, no rounding.
- `seq` is consumed only when `build` succeeds (validate a draft first, then stamp). A failed build must not leave a gap.

## Codec

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

## Names the SDK may hardcode

These are the only message types the SDK may name: `admin.hello`,
`admin.operator_hello`, `admin.hello_reply`, `admin.describe`, `admin.reply`,
`report.settings` (reply matching), `report.status` kinds `task`/`queue`,
`control.command`, `control.settings`, `control.queue`, `control.cancel`, and, for
stream matching only ([Calls](calls.md#module-callsmjs)), `query.core` kinds `history`/`assets`/`plugins`,
`query.asset`, `plugin.call`, `plugin.result` and `plugin.describe`. Everything
else (commands, reports, other query kinds) flows through generic `build`/`check` and
must need **zero** SDK code. Add a test that builds an example of every type and
kind in `protocol/definitions/` through `build` with no per-type branches.
