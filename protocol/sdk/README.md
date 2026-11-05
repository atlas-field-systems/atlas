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
Build it from [IMPLEMENTATION.md](IMPLEMENTATION.md): one slice per PR, in order,
and the developer approves each merge before the next slice starts.

| Doc | What it covers |
| --- | --- |
| [Implementation plan](IMPLEMENTATION.md) | Layout, signatures, build slices, tests, decided points |
| [How it works](how-it-works.md) | Front door, identity, caller surface, picture, adapters, reconnect |
| [Communication](../docs/communication.md) | The wire rules the SDK implements |
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
  IMPLEMENTATION.md   build plan
  # later: package source that loads ../definitions
```

Adapters will sit beside the SDK package once they exist, not inside Core.
