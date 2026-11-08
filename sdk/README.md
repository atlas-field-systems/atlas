# Atlas SDK

The one implementation every program uses: Core, gateways, operator apps, and
Assets. It builds, validates, and parses messages; handles keys, identity
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

**Status:** a draft, like everything in Atlas. Runtime code is
not built yet. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the future SDK build plan;
implementation starts when the owner requests it.

## One front door

Every program uses the SDK: **Core, bridges, operator apps, and Assets**.

- Callers build and read messages through helpers, not raw JSON. Fields,
  precision and left-out fields are kept exactly.
- The SDK validates on the way in and out against `definitions/`. Commands and
  every other message come from the definitions, never hardcoded.
- **Core does not re-implement schema validation.** It calls the shared
  `check()` when a message did not already arrive through an SDK edge (for
  example a raw test inject). After a valid message, Core runs **business rules
  only** (online?, command listed in `admin.describe`?, duplicate `task_id`?).
- Core owns [request admission](../core/docs/requests.md) before forwarding over
  field links. Shared SDK checks supply contract validation, not a second set of
  Core business rules.
- The Asset's [communications module](../asset/docs/assets.md#modules-and-equipment-drivers)
  manages the SDK. Other Asset modules own reporting decisions, current equipment
  checks, execution, and failsafes. Helpers never fly or control equipment.
- A reporting-only Asset needs no task-queue helper or artificial settings.
  [Early and minimal startup contracts](../protocol/docs/open-questions.md#unresolved)
  still need exact definitions before the link interfaces can implement them.
- Work is bounded. Queues, retries and history reads have limits, and programs
  can stop and close what they opened.
- [Diagnostic events](docs/logging.md) expose message handling, retries, outcomes,
  and errors to the host through an optional observer. Core and Asset apps attach
  a consumer for their required logging from the first prototype.

## Docs

| Doc | What it covers |
| --- | --- |
| [Messages](docs/messages.md) | Loading definitions, `check`, `build`, the codec, names the SDK may hardcode |
| [Identity and duplicates](docs/identity-and-duplicates.md) | Keys on hello, stamping `from`/`seq`/`time`, dedupe, contact, auth loss |
| [Links](docs/links.md) | Transport adapters, the link and its hello, reconnect, the observer |
| [Calls](docs/calls.md) | `request` / `stream` / `subscribe`, outcomes and errors |
| [Task queue](docs/task-queue.md) | The Asset-side queue helper |
| [Live picture](docs/live-picture.md) | The optional in-memory picture for operator apps |
| [Logging](docs/logging.md) | Detailed SDK events collected by the host |
| [Configuration](config.md) | Library controls and logging options for discussion |
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
  config.md           configuration inventory for discussion
  docs/               one doc per part of the SDK
  # later: src/, test/, adapters/ (see IMPLEMENTATION.md)
```

Adapters will sit beside the SDK package once they exist, not inside Core.
