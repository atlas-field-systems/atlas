# Atlas SDK

The one implementation every program uses: Core, gateways, operator apps, and
Assets on IP. It builds, validates, and parses messages; handles keys, identity
(`from` / `seq` / `time`), dedupe, queue sync, and reconnect; and is the only
front door to the wire.

It loads the definitions in [`definitions/`](../definitions) at runtime. It does
**not** define messages itself, and it does **not** generate code. A change to
the spec and its checks land in one PR.

Transport adapters (WebSocket, Meshtastic, FLRC) only move bytes. Each will be
its own package beside the SDK, so a program installs only the links it uses.

**Status:** how-it-works is locked (protocol 0.8). Runtime code is not built yet.
Do not implement the thin slice until the developer says to start.

| Doc | What it covers |
| --- | --- |
| [How it works](how-it-works.md) | Front door, identity, queue, picture, reconnect, Core-as-user |
| [Concepts](concepts.md) | The kept concepts, rewritten to match the locks |
| This README | Scope, non-goals, where code will live |

## Non-goals (for v1)

- Object / track / fusion / geo-feature messages (storage notes may exist; no wire types yet)
- Generated clients or OpenAPI
- Message-aware transports
- Auto-retry of operator commands after disconnect
- Live picture required on Assets

## Repo layout (planned)

```text
sdk/
  README.md           this file
  how-it-works.md     behavior contract
  concepts.md         concept list (locked)
  # later: package source that loads ../definitions
```

Adapters will sit beside the SDK package once they exist, not inside Core.
