# Protocol decisions

Decisions the developer made for the protocol. When a definition and this page disagree, fix one of them.

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
- Each command is its own message type. There is no generic command wrapper. **Reversed (proposed):** messages are grouped like nested folders, because one flat list is hard to read and to maintain: `admin` (hello, hello_reply), `control` (command, task) and `report` (status, failsafe, telemetry, settings). `type` is the dotted path, such as `control.task`, and `kind` picks the exact message, such as `move_to`. A command is what an Asset can be told to do; a task is one use of a command, and Assets queue tasks. Each task carries `plan_id`, `task_id` and `task_count`, so there is no separate plan message. Failsafe is its own type under report, so it can carry more context than a status. The wire form may be compacted later. See [proposals/broad-types.md](proposals/broad-types.md).
- `type`: which message this is, a short lowercase name such as `takeoff` or `telemetry`.
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the sender's own counter, up by one per message. On the mesh it shows dropped (gaps) and out-of-order messages.
- `asset_id`: the Asset a command is for, or the Asset a report is from.
- There is no sender field. Operators send commands. Plugins, if they ever send commands, are controlled by an operator, so who sent a command does not matter.
- For now, plugins do not act on their own to direct Assets or issue Tasks. This may change later.

## Values
- `asset_id` is 1 to 4 letters or digits (`A-Z`, `a-z`, `0-9`), such as `A1`. That is over 15 million IDs, far more than the roughly 20 Assets we expect (see the Charter's scale page). Every ID, not only `asset_id`, is 1 to 4 letters or digits. Any new `*_id` variable must use the same pattern; the check script enforces this.
- Field names are long and readable in the definitions and in message JSON.

## Commands
- Takeoff: a target altitude.
- Land: a landing position and an optional transit altitude. Without one, the Asset keeps its current altitude.
- Move To: a destination position. Without an altitude, the Asset keeps its current one (confirmed).
- Change Setting: a queued Task that sets exactly one setting to an explicit end state.

## Connect and reports (proposed)
- Hello: an Asset's first message on a link, with `protocol_version`. The API key stays at the link level, never in a message.
- Hello Reply: Core answers `accepted` or `version_mismatch`, with the version to run.
- Task Status: an Asset reports one Task's state (queued, active, completed, failed, cancelled), with an optional explanation.
- Failsafe Status: an Asset reports a failsafe it switched on by itself (return_home or link_loss_response), with an explanation.
- `task_id` is 1 to 4 letters or digits, like every ID.
- Gateways will likely register themselves like Assets, with a Hello.
- How Core reaches an Asset through a gateway (Core to gateway over IP, gateway to Asset over radio) is still open.

## Limits
- `type` is at most 32 characters.
- A position carries at most 4 altitudes, one per reference. An Asset rarely reports all of them at once.

## Compact JSON
- Compact JSON is the message minified: same keys, same structure, no extra spaces.
- Short keys (such as `time` -> `t`) are deferred to protocol 1.0. They are not implemented now, to avoid tangling the definitions.

## Radio compression
Radio links will use a proven existing compression method, chosen later.

## Storage
The protocol also defines the storage layout, so the whole data format lives here. Storage formats are not planned yet ([storage/](../storage/README.md)).

## Late reports
An older time never overwrites newer state. There is no "history-only" message.

## Settings
- (Proposed) The Asset's settings message, at connect or when it changes a setting itself, is a report: no confirmation. When Core sets a setting it is either immediate (a `control.command` with `kind: change_settings`, confirmed by a `report.settings` whose `reply_to` is Core's `seq`) or queued (a `control.task`, confirmed by its task status). Immediate is the easy default.
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
