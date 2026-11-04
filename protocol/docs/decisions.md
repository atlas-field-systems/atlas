# Protocol decisions

Decisions the developer made for the protocol. When a definition and this page disagree, fix one of them.

## The goal
All Atlas communication flows through this protocol. Improve the protocol, and everything improves.

## Building blocks
- The smallest piece is a **variable**: one named field, defined once in `definitions/variables/`.
- **Components** (`definitions/components/`) group variables that always travel together and are reused: `altitude` (value plus reference) and `position`.
- **Messages** (`definitions/messages/`) are built from variables and components. They are grouped like folders: `messages/<group>/<type>.json`, and each kind of a type in `messages/<group>/<type>/<kind>.json`.
- Messages, kinds and components only reference other files: a `$ref`, a `$ref` fixed to one value, or a list of a `$ref`. They never define a field themselves. The check script enforces this, so no field is ever defined twice.
- Each concept is defined once. For example, there is one altitude definition, used by Takeoff and by Position.
- Each file is JSON Schema (2020-12), with a plain description and at least one example.
- `definitions/index.json` lists every file. The CLI and web viewer read it, so they never hardcode the protocol.

## Every message
- Messages are flat: every field sits directly in the message, with no header or wrapper.
- **Adopted:** messages are grouped like nested folders, because one flat list of types is hard to read and to maintain. This reverses "each command is its own message type". See [proposals/broad-types.md](proposals/broad-types.md) for the reasoning and size comparison.

  ```text
  admin    hello, hello_reply
  control  command  (kind: takeoff, move_to, land; task_id = queued)
           settings (task_id = queued change_settings)
  query    asset, queue, core (kind: assets, history)
  report   status   (kind: asset, task, queue)
           failsafe (kind = trigger: link_loss, low_battery; response field)
           gimbal, observation
           telemetry, battery, settings
  ```
- `kind` picks the exact message within a type. Only types that have kinds carry it. The other fields stay flat.
- A **command** is something an Asset can do: takeoff, move_to, land. A **task** is one queued use of a command or a settings change. `control.command` and `control.settings` each take an optional `task_id`. Without it, the message runs now (a button press). With it, the message is a Task added to the end of the queue. Each kind is defined once.
- `admin.hello` lists `commands`, the command kinds the Asset accepts. Core never sends a kind not listed. Settings support is the set of settings in the Asset's `report.settings` on connect.
- **Immediate commands and settings changes run alongside the queue and do not pause it.**
- `query` holds questions: `query.asset` (ask for any report an Asset supports: Core asks the Asset, or an operator interface or edge link asks Core for its latest copy, such as the latest telemetry for the most recent position; optional `every_s` makes Core repeat it every N seconds, `every_s` 0 cancels, mostly for slow edge links), `query.queue` (either side asks for an Asset's queue, for example an Asset after reconnecting), and `query.core` (an operator interface asks Core for its Assets or stored history, over the operator API, which is not defined yet). Answers are always the normal messages, so no answer formats are added.
- Failsafe is its own type under `report`, so it sits with everything else the Asset tells Core but can carry more context than a status.
- `type`: which message this is, as its group and type joined by a dot, such as `control.command` or `report.telemetry`. It is the message's folder and file name.
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the sender's own counter, up by one per message. On the mesh it shows dropped (gaps) and out-of-order messages.
- `asset_id`: the Asset a command is for, or the Asset a report is from.
- There is no sender field. Operators send commands. Plugins, if they ever send commands, are controlled by an operator, so who sent a command does not matter.
- For now, plugins do not act on their own to direct Assets or issue Tasks. This may change later.

## Values
- `asset_id` is 1 to 4 letters or digits (`A-Z`, `a-z`, `0-9`), such as `A1`. That is over 15 million IDs, far more than the roughly 20 Assets we expect (see the Charter's scale page). Every ID, not only `asset_id`, is 1 to 4 letters or digits. Any new `*_id` variable must use the same pattern; the check script enforces this.
- Field names are long and readable in the definitions and in message JSON.

## Commands (kinds of `control.command`)
- takeoff: a target altitude.
- land: a landing position and an optional transit altitude. Without one, the Asset keeps its current altitude.
- move_to: a destination position. Without an altitude, the Asset keeps its current one (confirmed).

## Queue
- There are no Plans. A **queue** is just the list of an Asset's unfinished Tasks, in order. It is not an object and has no ID.
- `task_id` is unique per Asset, even after a Task finishes.
- The Asset sends `report.status` of kind `queue` (a list of `task_ids`) whenever Tasks are added, and when Core sends `query.queue`. This replaces `task_count`: Core compares the list with the Tasks it sent and resends any that are missing. One short report covers any number of Tasks.

## Connect and reports
- `admin.hello`: an Asset's first message on a link, with `protocol_version` and `reports`, the list of reports it sends (a drone without a battery sensor leaves out `battery`). The API key stays at the link level, never in a message.
- `admin.hello_reply`: Core answers `accepted` or `version_mismatch`, with the version to run.
- `report.status` kind `asset`: overall health. Kind `task`: one Task's state (queued, active, completed, failed, cancelled), with an optional explanation. Kind `queue`: the Asset's queue.
- `report.failsafe`: a failsafe triggered and the Asset acted by itself. `kind` is the trigger (`link_loss` or `low_battery`); `response` is what it does (`return_home`, `hold`, `land` or `continue`, the same values as the `link_loss_response` setting, defined once). A trigger and a response are different things, so they are never the same field.
- `report.battery`: the battery, on its own schedule, separate from telemetry, because it changes even when the Asset does not move.
- **Asset data reports are fixed and standard.** Every Asset reports battery, position and the rest with the same defined report and components. There are no free-form or "misc" fields. New kinds of Asset data get a new defined report.
- `task_id` is 1 to 4 letters or digits, like every ID.
- Gateways will likely register themselves like Assets, with a Hello. Later link business (gateway registration, time sync, goodbye) goes under `admin`.
- How Core reaches an Asset through a gateway (Core to gateway over IP, gateway to Asset over radio) is still open.

## Limits
- `type` and `kind` are each at most 32 characters.
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
- `report.settings`, sent at connect or when the Asset changes a setting itself, is a report and needs no confirmation.
- When Core changes a setting, it is either immediate or queued. An immediate change is a `control.settings` without `task_id` (the easy default, a button press), confirmed by a `report.settings` whose `reply_to` is the command's `seq`. A queued change is a `control.settings` with `task_id`, for example placed after a move_to,, confirmed by its task status.
- Settings are only variables, used by `report.settings` and `control.settings`; no setting has its own message.
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

## Storage, sensors and registration

- Core uses a normal store with one table per kind of thing: assets, tasks, observations, tracks, geo features and telemetry. No raw message store. See [Storage](storage.md).
- `admin.hello` declares cameras once: fixed or gimbal, direction from the nose, field of view. No zoom, no revision fields.
- `report.gimbal` gives live gimbal pointing, often while active, never while idle.
- `move_to` stays simple and never carries a geo feature. Cameras may give an optional roll.
- Assets send `report.observation`, never tracks. Fusion is a separate swappable Docker module: observations in, tracks out. It alone decides when observations are the same target. The first, temporary module makes one track per observation. Tasks target tracks.
- Assets self-register with a deployment enrollment key presented once on the link, not in hello. Keys are 16 random bytes (22 characters).
