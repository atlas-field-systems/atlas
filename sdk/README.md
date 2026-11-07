# Atlas SDK

The one implementation every program uses: Core, gateways, operator apps, and
Assets on IP. It builds, validates, and parses messages; handles keys, identity
(`from` / `seq` / `time`), dedupe, queue sync, and reconnect; and is the only
front door to the wire.

It loads Protocol's [`definitions/`](../protocol/definitions) at runtime. It does
**not** define messages itself, and it does **not** generate code. The SDK
implements the wire rules in [Communication](../protocol/docs/communication.md)
and the [laws](../protocol/docs/laws.md): the hello, duplicates, the task queue,
settings, link loss and reconnecting. These docs cover only what the SDK adds on
top. A change to the spec and the SDK can land in one PR.

Transport adapters (WebSocket, Meshtastic, FLRC) only move bytes. Each will be
its own package beside the SDK, so a program installs only the links it uses.

**Status:** a draft for protocol 0.8, like everything in Atlas. Runtime code is
not built yet. Build it from [IMPLEMENTATION.md](IMPLEMENTATION.md): one slice per
PR, in order, and the developer approves each merge before the next slice starts.

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
- One optional [observer](docs/links.md#observer-optional) lets a program watch
  the SDK's own activity without slowing or breaking it.

## Docs

| Doc | What it covers |
| --- | --- |
| [Messages](docs/messages.md) | Loading definitions, `check`, `build`, the codec, names the SDK may hardcode |
| [Identity and duplicates](docs/identity-and-duplicates.md) | Keys on hello, stamping `from`/`seq`/`time`, dedupe, contact, auth loss |
| [Links](docs/links.md) | Transport adapters, the link and its hello, reconnect, the observer |
| [Calls](docs/calls.md) | `request` / `stream` / `subscribe`, outcomes and errors |
| [Task queue](docs/task-queue.md) | The Asset-side queue helper |
| [Live picture](docs/live-picture.md) | The optional in-memory picture for operator apps |
| [Implementation plan](IMPLEMENTATION.md) | Layout, build slices, tests, current implementation points |

## Non-goals (for v1)

- Track and fusion messages (no wire types yet). Geo feature and Object messages need no SDK code; fetching an Object's file is not in v1
- Generated clients or OpenAPI
- Message-aware transports
- Auto-retry of operator commands after disconnect
- Live picture required on Assets

## Folder layout (planned)

```text
sdk/
  README.md           this file
  AGENTS.md           rules for agents working here
  IMPLEMENTATION.md   build plan
  docs/               one doc per part of the SDK
  # later: src/, test/, adapters/ (see IMPLEMENTATION.md)
```

Adapters will sit beside the SDK package once they exist, not inside Core.
