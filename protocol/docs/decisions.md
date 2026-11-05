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
- **Adopted:** messages are grouped like nested folders, because one flat list of types is hard to read and to maintain. This reverses "each command is its own message type". The cost is about 7 bytes per message for the group in `type`, plus the `kind` field where a type has kinds. Link compression wins most of it back; see [Compact JSON](#compact-json).

  ```text
  admin    hello, hello_reply, operator_hello, reply
  control  command  (kind: takeoff, move_to, land, return_to_home; task_id = queued)
           settings (task_id = queued change_settings)
           cancel   (task_id, or none for the motion running now)
  query    asset, queue, core (kind: assets, history)
  report   status   (kind: asset, task, queue)
           failsafe (kind = trigger: link_loss, low_battery; response field)
           observation (kind: coordinates, bearing)
           gimbal
           telemetry, battery, settings
  ```
- `kind` picks the exact message within a type. Only types that have kinds carry it. The other fields stay flat.
- A **command** is something an Asset can do: takeoff, move_to, land. A **task** is one queued use of a command or a settings change. `control.command` and `control.settings` each take an optional `task_id`. Without it, the message runs now (a button press). With it, the message is a Task added to the end of the queue. Each kind is defined once.
- `admin.describe` lists `commands`, the command kinds the Asset accepts, plus `reports` and `cameras`. Core never sends a kind not listed. Settings support is the set of settings in the Asset's `report.settings` on connect.
- **Immediate commands and settings changes run alongside the queue and do not pause it.**
- `query` holds questions: `query.asset` (ask for any report an Asset supports: Core asks the Asset, or an operator interface or edge link asks Core for its latest copy, such as the latest telemetry for the most recent position; optional `every_s` makes Core repeat it every N seconds, `every_s` 0 cancels, mostly for slow edge links), `query.queue` (either side asks for an Asset's queue, for example an Asset after reconnecting), and `query.core` (an operator interface asks Core for its Assets or stored history, over its operator WebSocket). Answers are always the normal messages, so no answer formats are added.
- Failsafe is its own type under `report`, so it sits with everything else the Asset tells Core but can carry more context than a status.
- `type`: which message this is, as its group and type joined by a dot, such as `control.command` or `report.telemetry`. It is the message's folder and file name.
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the creator's own counter, up by one per message that creator sends. On the mesh it shows dropped (gaps) and out-of-order messages.
- `from`: who created the message (Asset `asset_id`, operator `operator_id`, or `CORE`). Stays on the message end to end; Core forwards unchanged.
- `asset_id`: the Asset a command is for, or the Asset a report is from.
- Replies name the original with `reply_from` + `reply_to` (= that message's `from` and `seq`).
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
- The Asset sends `report.status` of kind `queue` (a list of `task_ids`) whenever Tasks are added, and when Core sends `query.queue`. This replaces `task_count`: Core compares the list with the Tasks it sent and resends any the Asset has never listed or reported on. One short report covers any number of Tasks.

## Connect and reports
- `admin.hello`: an Asset's first message on a link: `asset_id`, `from`, `protocol_version`, and keys only (`key` required; `enrollment_key` the first time). Reports, commands and cameras follow in `admin.describe`.
- `admin.hello_reply`: Core answers `accepted` or `version_mismatch`, with the version to run.
- `report.status` kind `asset`: overall health. Kind `task`: one Task's state (queued, active, completed, failed, cancelled), with an optional explanation. Kind `queue`: the Asset's queue.
- `report.failsafe`: a failsafe triggered and the Asset acted by itself. `kind` is the trigger (`link_loss` or `low_battery`); `response` is what it does (`continue`, `hold`, `land`, `return_to_home` or `land_at`, the same values as the `link_loss_response` setting, defined once). A trigger and a response are different things, so they are never the same field.
- `report.battery`: the battery, on its own schedule, separate from telemetry, because it changes even when the Asset does not move.
- **Asset data reports are fixed and standard.** Every Asset reports battery, position and the rest with the same defined report and components. There are no free-form or "misc" fields. New kinds of Asset data get a new defined report.
- `task_id` is 1 to 4 letters or digits, like every ID.
- Gateways will likely register themselves like Assets, with a Hello. Later link business (gateway registration, time sync, goodbye) goes under `admin`.
- How Core reaches an Asset through a gateway is the link's job, not the protocol's. See [Routing and duplicates](communication.md#routing-and-duplicates).

## Limits
- `type` and `kind` are each at most 32 characters.
- A position carries at most 4 altitudes, one per reference. An Asset rarely reports all of them at once.

## Compact JSON
- Compact JSON is the message minified: same keys, same structure, no extra spaces.
- No short keys (such as `time` -> `t`) and no type numbers, now or at 1.0. Names stay readable in the definitions, in messages and in storage.
- Compression does the work short keys would. On the first-flight run, deflating each message with a dictionary of the definitions' names takes 4661 bytes to 2041 (largest message 117); short keys on top save only 3% more.

## Radio compression
Each link chooses its own compression in its link profile: a proven existing method, chosen later. A link that compresses with a dictionary can build it from the definitions, because one version always means the same definitions (law 10). The hello and its reply are never compressed (law 12).

## Storage
The protocol also defines the storage layout, so the whole data format lives here. Core's tables are in [Storage](storage.md); stored record formats are not defined yet.

## Late reports
An older time never overwrites newer state. There is no "history-only" message.

## Settings
- `report.settings`, sent at connect or when the Asset changes a setting itself, is a report and needs no confirmation.
- When Core changes a setting, it is either immediate or queued. An immediate change is a `control.settings` without `task_id` (the easy default, a button press), confirmed by a `report.settings` whose `reply_from` and `reply_to` name the command. A queued change is a `control.settings` with `task_id`, for example placed after a move_to,, confirmed by its task status.
- Settings are only variables, used by `report.settings` and `control.settings`; no setting has its own message.
- Starting settings: `run_state` (paused/running), `lights` (on/off), `landing_gear` (up/down), `link_loss_response` (continue/hold/land/return_to_home/land_at) and `low_battery_response` (the same list without continue), and `land_at_position`, the point `land_at` goes to (not necessarily the takeoff point).
- Each change is an explicit end state, never a toggle. The most recent time wins.
- No custom per-Asset settings yet.

## Versions
- Everything is assumed up to date. There is no backward compatibility.
- There is one version check, at connect. A mismatch is rejected with a clear "update this device" error.
- Every change after a release is a new version, even an additive one (law 10).

## Tools
The CLI and web viewer only display messages. They never send to a live Core.
They show the readable JSON beside the compressed bytes (hex dump and base64), with both sizes, so compression can be inspected.

## First version
Takeoff, Settings, Status, and Telemetry. Port the rest later.

## Storage, sensors and registration

- Core uses a normal store with one table per kind of thing: assets, tasks, observations, tracks, geo features and telemetry. No raw message store. See [Storage](storage.md).
- `admin.describe` declares cameras once: fixed or gimbal, direction from the nose, field of view. No zoom, no revision fields.
- `report.gimbal` gives live gimbal pointing, often while active, never while idle.
- `move_to` stays simple and never carries a geo feature. Cameras may give an optional roll.
- Assets send `report.observation`, never tracks. Fusion is a separate swappable Docker module: observations in, tracks out. It alone decides when observations are the same target. The first, temporary module makes one track per observation. Tasks target tracks.
- Observations (0.8). `kind` says what the sensor measured, not which sensor: `coordinates` (the target's position) or `bearing` (from a recorded `origin`: bearing, optional elevation and range). ADS-B is `coordinates`. The origin is what the Asset recorded when it saw the target, never taken from telemetry, and has no uncertainty of its own.
- One `entity_type` list names what Assets, observations and tracks are: person, ground_vehicle, airplane, helicopter, drone, aircraft (type unknown), watercraft, animal, structure, fixed_sensor, other. Left out means unknown. An Asset may give it in `admin.describe`.
- Uncertainty is an ellipse (a circle when only `semi_major_m` is given) or a polygon of up to 32 corners, plus an optional `altitude_uncertainty_m`; bearing, elevation and range each have their own. Every bound is 95% (law 8). Left out means unknown, never exact. Observations and tracks share it.
- A position with no altitude means the altitude was not measured. Displays draw it at ground level; fusion never reads it as "on the ground".
- Extra facts go in `details`, a fixed list of specific details (`icao_address`, `callsign`, `squawk`, `color`), not broad groups, so tools can read and show each one. A new kind of detail is added to the list. Each stays true for its observation until replaced.
- Target speed and direction of travel are not sent; fusion works them out from successive positions.
- Assets self-register with a deployment enrollment key presented once, in the first hello (from 0.6). Keys are 16 random bytes (22 characters).

## Queue order, cancel and failures (0.4)

- Core owns the ordered list of `task_id`s per Asset. It sends each task body once; the Asset reports the queue it holds; Core resends only missing bodies. A Task whose `task_id` the Asset already holds is ignored. There is no `task_seq` and no gap-wait.
- `admin.describe` `commands` may be empty, for a receive-only Asset such as an ADS-B receiver.
- An immediate motion command (no `task_id`) cancels the rest of the queue; the Asset reports each cancelled Task and its empty queue. Settings stay immediate beside the queue.
- `control.cancel` stops a Task (by `task_id`) or the motion running now (no `task_id`). When motion stops, the Asset holds and sets `run_state` paused; cancelling a queued Task only drops it (0.7). It reports the Task cancelled plus `report.settings` with `reply_from` and `reply_to`.
- When a Task fails, or a failsafe triggers with any response except `continue`, the Asset cancels the rest of the queue and reports each cancelled Task and its empty queue.
- `return_to_home` is a command, and the same name is a failsafe response.
- Each trigger has its own response setting. `link_loss_response` may be `continue`: the Asset keeps its mission and resyncs (`query.queue`) when the link returns, as when Core drives through a tunnel.
- History is first-class: Core keeps an append-only, time-ordered log, and `query.core` kind `history` with `asset_id`, `report: telemetry`, `since` and `until` returns an Asset's past path.
- Link bandwidth is a link-design concern (link profiles), not a message concern.

## Operator API (0.5)

- Each operator interface opens one WebSocket to Core and uses the same messages as Assets, pushed both ways, with no polling. No user accounts or roles.
- It presents its own `operator_id` and 16-byte key (with the link opening in 0.5; in `admin.operator_hello` from 0.6), checked like an asset key (Core stores the hash), then sends `admin.operator_hello`. Core answers `admin.hello_reply` with `operator_id`.
- On connect, Core pushes every Asset's latest `admin.describe` and latest reports unchanged, then forwards telemetry, status, queue changes and failsafes live (still unchanged).
- Operators send `control.command`, `control.settings` and `control.cancel` with `asset_id`. Core checks them against the Asset's `admin.describe` and refuses unsupported ones with a reason. Reading uses `query.core` and `query.asset` (`every_s`).
- Core answers every operator message with `admin.reply` (`accepted` or `refused` with `explanation`, `reply_from` + `reply_to` naming its (`from`, `seq`)). The Asset's reports confirm the effect.
- Routing is the link's job. A receiver handles a message once per `(from, seq, time)`; see [Routing and duplicates](communication.md#routing-and-duplicates).

## Keys, links and answers (0.6)

- Keys travel in the opening hello, not the link opening (browsers cannot set WebSocket headers, and URLs end up in logs). `admin.hello` requires `key` and carries `enrollment_key` the first time; `admin.operator_hello` carries `key`. No other message carries a key, and Core never sends one: operators get the Asset's `admin.describe` forwarded unchanged. A bad key gets `hello_result: refused` and the link closes.
- The hello must be the first message on a link. Anything before an accepted hello closes the link.
- One link per ID. Each operator interface has its own `operator_id`. A second link with the same `asset_id` or `operator_id` replaces the older one.
- Everything a creator sends gets a new `seq`. Core forwards other creators' messages unchanged. A deliberate repeat (including `every_s`) is a new message with a new `seq` from its creator, so the duplicate rule never drops it.
- A command to an Asset that is not connected is refused with a reason. Core does not hold it.
- A query's answer comes first and its `admin.reply` last, marking the end. An accepted reply with nothing before it means nothing matched.- A repeated `task_id` from an operator is refused by Core with a reason. (An Asset ignores a resent Task it holds, and resends the final report of one it finished.)
- Telemetry rate is the Asset setting `telemetry_every_s`.

## Recovery (0.7)

From the review of the first-flight prototype: lost, repeated, late and reordered messages, and restarts, must not repeat work or erase what Core knows. See [communication.md](communication.md).

- **Duplicates and retries.** A message is identified by `(from, seq, time)`. A retry is the same message unchanged, and a receiver that answered it sends the same answer again (Core's last-answer cache). A restarted Asset or operator interface may start `seq` at 0; its `time` keeps the new messages distinct, so the "lower hello means restart" rule is gone. Core keeps its own `seq` across restarts for messages it creates (`from` = `CORE`).
- **Clocks.** A creator's clock never goes backwards, even across a restart, and it sends nothing before its clock is set. Clocks do not need to match each other.
- **Tasks move forward only.** The first final state stays. A late or contradicting report goes to history, changes nothing and is not forwarded.
- **Final reports are acknowledged.** The Asset resends a Task's final report until Core answers with `admin.reply`, which names the `task_id` so an answer can't be matched to the wrong report after the Asset's `seq` restarts. Core resends a Task only while the Asset has never listed it or reported on it. A Task lost in an Asset restart stays unknown and is not run again.
- **An Asset never runs a `task_id` twice.** It remembers at least its last 1024 finished Tasks and resends their final report if one arrives again.
- **Cancel never creates a Task.** Core refuses a cancel for an unknown or finished Task. Cancelling a queued Task leaves the running one alone. A cancel that arrives before its Task makes the Asset remember it as cancelled.
- **Settings.** The connect report (after each accepted hello) lists every supported setting. Later reports may carry only some; a setting left out is unchanged. Per setting the newest `time` wins, and an Asset never sends two settings reports with the same `time`.
- **Link loss.** Contact with Core means hearing new (non-duplicate) messages after the accepted hello that name this Asset in `asset_id` and were not sent by this Asset. Core sends `admin.alive` when it has sent nothing new for a while (repeated answers don't count). With no contact for `link_loss_after_s` (a setting, 30 s unless set), the `link_loss` failsafe triggers once. With `continue` the Asset keeps its Task and queue.

## Acknowledgements and edges (0.8)

Owner answers to the edges a throwaway Core prototype of 0.7 found.

- **What must arrive is acknowledged** (law 23). Core acknowledges an Asset's `admin.describe` and connect `report.settings` as it does final reports, and the Asset waits for each before going on, so a later partial settings report is never taken for the full list.
- **Core starts first and stops last.** A Core restart mid-operation is not designed for: Core keeps its `seq`, but not which messages it has handled, and a final report for a Task Core doesn't know does not occur.
- **A resent Task is a retry.** Core forwards an operator's Task unchanged, so resending a missing body sends the same bytes.
- **Same-millisecond settings changes.** Two changes to one setting with the same `time` can tie. Accepted as too rare for a rule.
- **A cancel that changes no setting** is answered with `run_state` unchanged.
- **Paused waits.** A new immediate command runs while paused, but queued tasks wait for `run_state: running`.
- **Link loss on the ground.** It counts there too; every response except `continue` keeps the Asset down and cancels its queue.

## SDK locks (0.8)

Locked for the SDK how-it-works docs and the matching protocol cuts. Details: [sdk/README.md](../sdk/README.md).

- **Origin:** every message has `from`; Core forwards unchanged; replies use `reply_from` + `reply_to`; duplicates are `(from, seq, time)`.
- **Dedupe:** act once, deliver always; streams, subscribers and the picture still receive replays; the picture upserts by `(from, seq, time)`.
- **Core uses the SDK:** one shared `check()`; Core owns business rules only (no second schema engine).
- **Caller surface:** `request` / `stream` / `subscribe` with outcomes `accepted` | `rejected` | `unknown`.
- **Subscribe:** callback is `{msg, raw, duplicate}` (same as `onMessage`); acting code skips duplicates.
- **Live picture:** on-demand by default; opt-in live; on disconnect last snapshot readable as `stale: true` (ready may stay true).
- **Transports:** bytes-only adapters (`open` / `send` / `onData` / `onClose` / `close`).
- **Queue:** drop `task_seq` and gap-wait; Core-owned ordered `task_id` list.
- **Identity:** one SDK module for keys-on-hello, `from`/`seq`/`time` stamp, and remember/dedupe; Core keeps a last-answer cache only.
- **Contact:** new post-hello messages with this Asset's `asset_id` whose `from` is not this Asset (not only `from: CORE`).
- **Stream items:** the inbound messages that match the query's own fields, once each, until its `admin.reply`. Core forwards live traffic as usual meanwhile; no ordering rule and no correlation field.
- **Reconnect:** Asset SDK auto-resynces in order describe → connect `report.settings` (each waiting for Core's `admin.reply`) → unacked finals → queue report → `query.queue`; operator live picture rebuilds from Core's connect push; inflight request → `unknown`; no auto-retry of operator commands.
- **Handshake vs description:** hello = keys + version + id; `admin.describe` is keyless; `admin.asset` is removed.
