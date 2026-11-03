# Protocol decisions

Decisions Lane made for the protocol. When a definition and this page disagree, fix one of them.

## The goal
All Atlas communication flows through this protocol. Improve the protocol, and everything improves.

## Building blocks
- The smallest piece is a **variable**: one named field, defined once in `definitions/variables/`.
- **Components** (`definitions/components/`) group variables that always travel together and are reused: `altitude` (value plus reference) and `position`.
- **Messages** (`definitions/messages/`) are built from variables and components.
- Messages and components only reference other files: a `$ref`, a `$ref` fixed to one value, or a list of a `$ref`. They never define a field themselves. The check script enforces this, so no field is ever defined twice.
- Each concept is defined once. For example, there is one altitude definition, used by Takeoff and by Position.
- Each file is JSON Schema (2020-12), with a plain description and at least one example.
- `definitions/index.json` lists every file. The CLI and web viewer read it, so they never hardcode the protocol.

## Every message
- Messages are flat: every field sits directly in the message, with no header or wrapper.
- Each command is its own message type. There is no generic command wrapper.
- `type`: which message this is, a short lowercase name such as `takeoff` or `telemetry`.
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the sender's own counter, up by one per message. On the mesh it shows dropped (gaps) and out-of-order messages.
- `asset_id`: the Asset a command is for, or the Asset a report is from.
- There is no sender field. Commands come from operators, and reports carry `asset_id`.

## Values
- `asset_id` is 1 to 4 letters or digits (`A-Z`, `a-z`, `0-9`), such as `A1`. That is over 15 million IDs, far more than the roughly 20 Assets we expect (see the Charter's scale page). Other IDs stay standard UUIDs for now.
- Field names are long and readable in the definitions and in message JSON.

## Commands
- Takeoff: a target altitude.
- Land: a landing position and an optional transit altitude. Without one, the Asset keeps its current altitude.
- Move To: a destination position. Without an altitude, the Asset keeps its current one.
- Change Setting: a queued Task that sets exactly one setting to an explicit end state.

## Compact JSON
- Compact JSON is the message minified: same keys, same structure, no extra spaces.
- Short keys (such as `time` -> `t`) are deferred to protocol 1.0. They are not implemented now, to avoid tangling the definitions.

## Late reports
An older time never overwrites newer state. There is no "history-only" message.

## Settings
- Settings are only variables used by the Settings message; no setting has its own message.
- Starting settings: `run_state` (paused/running), `lights` (on/off), `landing_gear` (up/down), `link_loss_response` (return_home/hold/land/continue).
- Each change is an explicit end state, never a toggle. The most recent time wins.
- No custom per-Asset settings yet.

## Versions
- Everything is assumed up to date. There is no backward compatibility.
- There is one version check, at connect. A mismatch is rejected with a clear "update this device" error.

## Tools
The CLI and web viewer only display messages. They never send to a live Core.
They show the readable JSON beside the compressed bytes (hex dump and base64), with both sizes, so compression can be inspected.

## First version
Takeoff, Settings, Status, and Telemetry. Port the rest later.
