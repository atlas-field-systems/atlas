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
  control  command  (kind: takeoff, move_to, land, return_to_home; task_id = a Task's body)
           settings (task_id = a Task's body)
           queue    (the order, as task_ids)
           cancel   (the motion running now)
  query    asset, queue, core (kind: assets, history, plugins)
  report   status   (kind: asset, task, queue)
           failsafe (kind = trigger: link_loss, low_battery; response field)
           observation (kind: coordinates, bearing)
           gimbal
           telemetry, battery, settings
  plugin   describe, call, result (kind = action: ground_elevation)
  geofeature set (kind: point, line, area), delete
  object   describe
  ```
- `kind` picks the exact message within a type. Only types that have kinds carry it. The other fields stay flat.
- A **command** is something an Asset can do: takeoff, move_to, land. A **task** is one queued use of a command or a settings change. `control.command` and `control.settings` each take an optional `task_id`. Without it, the message runs now (a button press). With it, the message is a Task's body; `control.queue` gives the order. Each kind is defined once.
- `admin.describe` lists `commands`, the command kinds the Asset accepts, plus `reports` and `cameras`. Core never sends a kind not listed. Settings support is the set of settings in the Asset's `report.settings` on connect.
- **Immediate settings changes run beside the queue; an immediate motion command clears it.**
- `query` holds questions: `query.asset` (ask for any report an Asset supports: Core asks the Asset, or an operator interface or edge link asks Core for its latest copy, such as the latest telemetry for the most recent position; optional `every_s` makes Core repeat it every N seconds, `every_s` 0 cancels, mostly for slow edge links), `query.queue` (Core asks an Asset for its queue), and `query.core` (an operator interface asks Core for its Assets or stored history, over its operator WebSocket). Answers are always the normal messages, so no answer formats are added.
- Failsafe is its own type under `report`, so it sits with everything else the Asset tells Core but can carry more context than a status.
- `type`: which message this is, as its group and type joined by a dot, such as `control.command` or `report.telemetry`. It is the message's folder and file name.
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the creator's own counter, up by one per message that creator sends. On the mesh it shows dropped (gaps) and out-of-order messages.
- `from`: who created the message (Asset `asset_id`, operator `operator_id`, or `CORE`). Stays on the message end to end; Core forwards unchanged.
- `asset_id`: the Asset a command is for, or the Asset a report is from.
- Replies name the original with `reply_from` + `reply_to` (= that message's `from` and `seq`).

## Plugins
- Plugins run inside Core. The protocol carries only a call to a Plugin's action and its result. How a Plugin works with the rest of Core is Core's own business, like traffic between Core's pillars. See the Charter's [Plugins](https://github.com/atlas-field-systems/atlas/blob/main/atlas/plugins.md) page.
- Plugins get their own message group, `plugin`: `plugin.describe` (one Plugin and the actions it offers), `plugin.call` and `plugin.result`.
- Core sends one `plugin.describe` per Plugin when an operator connects. An operator can also ask with `query.core` kind `plugins`.
- Each action is a kind of `plugin.call` and `plugin.result`, defined once in Protocol, like a command kind (law 15). A Plugin lists the actions it offers, and several Plugins may offer the same one. A new action is a Protocol change, even when it reuses existing inputs.
- Plugin messages are from `CORE`, with `plugin_id` naming the Plugin, because Plugins are inside Core.
- Every action input is built from Protocol variables and components, such as a box, a position or a geo feature ID. A new kind of input is a Protocol change, documented with its reason.
- A call is answered like a query: one `plugin.result` per output item, naming the call with `reply_from` and `reply_to`, then `admin.reply` to mark the end. There is no list size limit. `admin.reply` says `accepted` when the call finished, `refused` when it never ran, or `failed` when the Plugin ran and broke; results already sent still stand. A long call sends nothing until it has results; progress and cancel wait until a real Plugin needs them. A result that must outlive the call is stored in Core with an ID and returned as a reference, so closing the operator interface loses nothing.
- An action's output is a list returned to the caller, or a reference to what the Plugin created in Core (an Object, a Track, a geo feature or another Entity).
- Outputs follow the same rule as inputs. Each action says what one list item is, built from Protocol variables and components, such as an altitude for a ground elevation or an unsaved geo feature for a building. A new kind of output is a Protocol change. Plugin data varies more than the rest of Atlas, so these additions are expected often.
- Only operator interfaces call Plugins for now. Assets will be allowed to later.
- For now, plugins do not act on their own to direct Assets or issue Tasks. This may change later.

## Geo features and Objects
- A **geo feature** is a point, line or area made in Core, by an operator or a Plugin. It is `geofeature_id`, `kind` (its shape: `point`, `line` or `area`) and an optional `name`, plus its shape: a `position`, a `line` (2 to 32 points) or an `area` (3 to 32 corners). There is no list of meanings, such as building or no-fly zone, until something reads one. Findings never go on a geo feature; each Plugin action says whether its output is a result list or Objects.
- `geofeature.set` carries the whole geo feature, so a change is an end state and the newest `time` wins. Without `geofeature_id` it creates one; with it, it replaces that one. `geofeature.delete` removes one. Core answers each with `admin.reply` and sends the result to every operator interface as its own message (`from` is `CORE`). On connect, Core pushes every geo feature. Geo features are not sent to Assets.
- An **Object** is a file Core holds. `object.describe` says what it is: `object_id`, `name`, `content_type`, `size_bytes`, and optionally `plugin_id` and `geofeature_id`. Core sends it once the file is stored and pushes every Object on connect. The file never travels in a message (law 13). An operator interface fetches it from Core over HTTP by `object_id`, only when it needs it. Only Plugins make Objects for now; there are no uploads.
- An Object is attached to at most one geo feature, by `geofeature_id` on the Object. A geo feature can have many Objects. The link is stored once, on the Object; an operator interface lists a geo feature's Objects from the `object.describe`s it holds. Deleting a geo feature leaves its Objects, which keep its ID as a record.
- **Core picks** `geofeature_id` and `object_id`, so no creator retries against a taken ID over a slow link. For a create, Core's `admin.reply` carries the new `geofeature_id`. Neither ID is reused in a run, even after a delete.
- **Tasks copy shapes.** A command that uses a geo feature's shape carries its own copy, plus `geofeature_id` as a record of where it came from. The Asset ignores the ID and never looks the geo feature up, so editing or deleting a geo feature never changes a command already sent. `move_to` and `land` take it today; the first command that takes a line or an area will too.

## Values
- `asset_id` is 1 to 4 letters or digits (`A-Z`, `a-z`, `0-9`), such as `A1`. That is over 15 million IDs, far more than the roughly 20 Assets we expect (see the Charter's scale page). Every ID, not only `asset_id`, is 1 to 4 letters or digits. Any new `*_id` variable must use the same pattern; the check script enforces this.
- Field names are long and readable in the definitions and in message JSON.

## Commands (kinds of `control.command`)
- takeoff: a target altitude.
- land: a landing position and an optional transit altitude. Without one, the Asset keeps its current altitude.
- move_to: a destination position. Without an altitude, the Asset keeps its current one (confirmed).

## Queue
- There are no Plans. A **queue** is just the list of an Asset's Tasks not started yet, in order. It is not an object and has no ID.
- `task_id` is unique per Asset, even after a Task finishes.
- **The Asset owns its queue and always carries all of it**, so it never leaves with part of a mission. Each body is sent once, all at once. `control.queue` carries the order as `task_id`s plus the `queue_version` it was built on; it takes effect only when every body is on board, and is ignored when built on an old version. Lists are tiny, so this stays light on slow links. Details: [communication.md](communication.md#delivering-a-task-queue).
- Any failure on the Asset triggers its configured failsafe. A failsafe with any response except `continue`, or an immediate motion command, clears the queue. What triggers which failsafe is the Asset's call and not decided yet.

## Connect and reports
- `admin.hello`: an Asset's first message on a link: `asset_id`, `from`, and keys only (`key` required; `enrollment_key` the first time). Reports, commands and cameras follow in `admin.describe`.
- `admin.hello_reply`: Core answers `accepted` or `refused`.
- `report.status` kind `asset`: overall health. Kind `task`: one Task's state (queued, active, completed, failed, cancelled), with an optional explanation. Kind `queue`: the Asset's queue.
- `report.failsafe`: a failsafe triggered and the Asset acted by itself. `kind` is the trigger (`link_loss` or `low_battery`); `response` is what it does (`continue`, `hold`, `land` or `return_to_home`, the same values as the `link_loss_response` setting, defined once). A trigger and a response are different things, so they are never the same field.
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
- No short keys (such as `time` -> `t`) and no type numbers, now or later. Names stay readable in the definitions, in messages and in storage.
- Compression does the work short keys would. On the first-flight run, deflating each message with a dictionary of the definitions' names takes 4661 bytes to 2041 (largest message 117); short keys on top save only 3% more.

## Radio compression
Each link chooses its own compression in its link profile: a proven existing method, chosen later. A link that compresses with a dictionary can build it from the definitions, with matching dictionaries supplied by the link profile. The hello and its reply are never compressed (law 12).

## Storage
Protocol also defines domain-storage records, so shared data uses the same names
and shapes throughout Atlas. Local configuration and diagnostic records belong to
their runtime components. Core's domain tables are in [Storage](storage.md);
stored record formats are not defined yet.

## Late reports
An older report never overwrites newer state. Settings reports from the same
Asset use `time`, then `seq` to break a tie ([communication](communication.md#settings)).
Operator command timestamps do not decide which settings the Asset applies.
There is no "history-only" message.

## Settings
- `report.settings`, sent when the Asset changes a setting itself, is a report and needs no confirmation. The connect report is the exception: Core acknowledges it with `admin.reply` (law 23).
- When Core changes a setting, it is either immediate or queued. An immediate change is a `control.settings` without `task_id` (the easy default, a button press), confirmed by a `report.settings` whose `reply_from` and `reply_to` name the command. A queued change is a `control.settings` with `task_id`, for example placed after a move_to. It applies when the Task runs and is confirmed by `report.settings` and its task status.
- Settings are variables, grouped once in the `settings` component that `report.settings` and `control.settings` both carry; no setting has its own message.
- Starting settings: `run_state` (paused/running), `lights` (on/off), `landing_gear` (up/down), `link_loss_response` (continue/hold/land/return_to_home) and `low_battery_response` (the same list without continue), and `home_position`, where `return_to_home` goes. The Asset sets it to where it starts up and an operator can move it, so there is no separate landing-point setting.
- Each change is an explicit end state, never a toggle. The Asset applies new immediate changes in receipt order, and queued changes when their Task runs. Request timestamps do not determine execution order; safe responses still take precedence.
- No custom per-Asset settings yet.

## Package releases
Protocol's published package version is its only version ([law 10](laws.md)).
Definitions and wire messages have no version field, and links do not negotiate
one. Package publishing is not configured yet.

## Tools
The CLI and web viewer only display messages. They never send to a live Core.
They show the readable JSON beside the compressed bytes (hex dump and base64), with both sizes, so compression can be inspected.

## Storage, sensors and registration

- Core uses a normal store with one table per kind of thing: assets, tasks, observations, tracks, geo features, Objects and telemetry. The separate diagnostic transcript belongs to [Core logging](../../core/docs/logging.md). See [Storage](storage.md) for domain records.
- `admin.describe` declares cameras once: fixed or gimbal, direction from the nose, field of view. No zoom, no revision fields.
- `report.gimbal` gives live gimbal pointing, often while active, never while idle.
- A command never depends on a geo feature. Cameras may give an optional roll.
- Assets send `report.observation`, never tracks. Fusion alone decides when observations are the same target. Tasks target tracks. Core owns the [fusion module and its planned first implementation](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/fusion.md).
- Observations. `kind` says what the sensor measured, not which sensor: `coordinates` (the target's position) or `bearing` (from a recorded `origin`: bearing, optional elevation and range). ADS-B is `coordinates`. The origin is what the Asset recorded when it saw the target, never taken from telemetry, and has no uncertainty of its own.
- One `entity_type` list names what Assets, observations and tracks are: person, ground_vehicle, airplane, helicopter, drone, aircraft (type unknown), watercraft, animal, structure, fixed_sensor, other. Left out means unknown. An Asset may give it in `admin.describe`.
- Uncertainty is an ellipse (a circle when only `semi_major_m` is given) or a polygon of up to 32 corners, plus an optional `altitude_uncertainty_m`; bearing, elevation and range each have their own. Every bound is 95% (law 8). Left out means unknown, never exact. Observations and tracks share it.
- A position with no altitude means the altitude was not measured. Displays draw it at ground level; fusion never reads it as "on the ground".
- Extra facts go in `details`, a fixed list of specific details (`icao_address`, `callsign`, `squawk`, `color`), not broad groups, so tools can read and show each one. A new kind of detail is added to the list. Each stays true for its observation until replaced.
- Target speed and direction of travel are not sent; fusion works them out from successive positions.
- Assets self-register with a deployment enrollment key presented once, in the first hello. Keys are 16 random bytes (22 characters).

## Queue order, cancel and failures

- `admin.describe` `commands` may be empty, for a receive-only Asset such as an ADS-B receiver.
- `control.cancel` stops the motion running now: the Asset holds, sets `run_state` paused, reports the Task cancelled and answers with `report.settings` naming the cancel. A new list drops queued Tasks.
- `return_to_home` is a command, and the same name is a failsafe response.
- Each trigger has its own response setting. `link_loss_response` may be `continue`: the Asset keeps flying its queue, as when Core drives through a tunnel.
- History is first-class: Core keeps an append-only, time-ordered log, and `query.core` kind `history` with `asset_id`, `report: telemetry`, `since` and `until` returns an Asset's past path.
- Link bandwidth is a link-design concern (link profiles), not a message concern.

## Operator API

- Each operator interface opens one WebSocket to Core and uses the same messages as Assets, pushed both ways, with no polling. No user accounts or roles.
- It presents its own `operator_id` and 16-byte key in `admin.operator_hello`, checked like an asset key (Core stores the hash), then sends `admin.operator_hello`. Core answers `admin.hello_reply` with `operator_id`.
- On connect, Core pushes every Asset's latest `admin.describe` and latest reports unchanged, then forwards telemetry, status, queue changes and failsafes live (still unchanged).
- Operators send `control.command`, `control.settings`, `control.queue` and `control.cancel` with `asset_id`. Core checks them against the Asset's `admin.describe` and refuses unsupported ones with a reason. Reading uses `query.core` and `query.asset` (`every_s`).
- Core answers every operator message with `admin.reply` (`accepted` or `refused` with `explanation`, `reply_from` + `reply_to` naming its (`from`, `seq`)). The Asset's reports confirm the effect.
- Routing is the link's job. A receiver handles a message once per `(from, seq, time)`; see [Routing and duplicates](communication.md#routing-and-duplicates).

## Keys, links and answers

- Keys travel in the opening hello, not the link opening (browsers cannot set WebSocket headers, and URLs end up in logs). `admin.hello` requires `key` and carries `enrollment_key` the first time; `admin.operator_hello` carries `key`. No other message carries a key, and Core never sends one: operators get the Asset's `admin.describe` forwarded unchanged. A bad key gets `hello_result: refused` and the link closes.
- The hello must be the first message on a link. Anything before an accepted hello closes the link.
- One link per ID. Each operator interface has its own `operator_id`. A second link with the same `asset_id` or `operator_id` replaces the older one.
- Everything a creator sends gets a new `seq`. Core forwards other creators' messages unchanged. A deliberate repeat (including `every_s`) is a new message with a new `seq` from its creator, so the duplicate rule never drops it.
- A command to an Asset that is not connected is refused with a reason. Core does not hold it.
- A query's answer comes first and its `admin.reply` last, marking the end. An accepted reply with nothing before it means nothing matched.- A repeated `task_id` from an operator is refused by Core with a reason. (An Asset ignores a resent Task it holds, and resends the final report of one it finished.)
- Telemetry rate is the Asset setting `telemetry_every_s`.

## Recovery

From the review of the first-flight prototype: lost, repeated, late and reordered messages must not repeat work or erase what Core knows. See [communication.md](communication.md).

- **Duplicates and retries.** A message is identified by `(from, seq, time)`. A retry is the same message unchanged, and a receiver that answered it sends the same answer again (Core's last-answer cache). A creator keeps one `seq` counter for the operation, including across link reconnects. Processes stay running throughout the operation.
- **Clocks.** A creator's clock never goes backwards during an operation, and it sends nothing before its clock is set. Clocks do not need to match each other.
- **Tasks move forward only.** The first final state stays. A late or contradicting report goes to history, changes nothing and is not forwarded.
- **Final reports are acknowledged.** The Asset resends a Task's final report until Core answers with `admin.reply`, naming the report and its `task_id`. A lost acknowledgement is covered by resending the same final report.
- **An Asset never runs a `task_id` twice.** It remembers its finished Tasks for the whole operation and resends their final report if one arrives again.
- **Settings.** The connect report (after each accepted hello) lists every supported setting. Later reports may carry only some; a setting left out is unchanged. Views order each setting by the Asset report's `time`, then `seq` for a tie. The Asset applies requests in receipt order rather than comparing creator clocks.
- **Link loss.** Contact with Core means hearing new (non-duplicate) messages after the accepted hello that name this Asset in `asset_id` and were not sent by this Asset. Core sends `admin.alive` when it has sent nothing new for a while (repeated answers don't count). With no contact for `link_loss_after_s` (a setting, 30 s unless set), the `link_loss` failsafe triggers once. With `continue` the Asset keeps its Task and queue.

## Acknowledgements and edges

Selected answers to edge cases found during prototyping.

- **What must arrive is acknowledged** (law 23). Core acknowledges an Asset's `admin.describe` and connect `report.settings` as it does final reports, and the Asset waits for each before going on, so a later partial settings report is never taken for the full list.
- **Core starts first and stops last.** Core, gateways, Assets, and their SDK instances stay running for the operation. Recovery covers link reconnects, not process restarts.
- **A resent Task is a retry.** Core forwards an operator's Task unchanged, so resending a missing body sends the same bytes.
- **Same-millisecond settings reports.** The Asset's `seq` orders reports whose `time` is equal; no extra field or clock synchronisation is required.
- **Paused waits.** A new immediate command runs while paused, but queued tasks wait for `run_state: running`.
- **Queued settings are confirmed** with `report.settings` naming the Task, like immediate ones. A queued change applies when that Task runs, regardless of its body's timestamp.
- **Link loss on the ground.** It counts there too; every response except `continue` keeps the Asset down and clears its queue.

## SDK choices

Drafted for the SDK docs and the matching protocol cuts. Details: [SDK](../../sdk/README.md).

- **Origin:** every message has `from`; Core forwards unchanged; replies use `reply_from` + `reply_to`; duplicates are `(from, seq, time)`.
- **Dedupe:** act once, deliver always; streams, subscribers and the picture still receive replays; the picture upserts by `(from, seq, time)`.
- **Core uses the SDK:** one shared `check()`; Core owns business rules only (no second schema engine).
- **Caller surface:** `request` / `stream` / `subscribe` with outcomes `accepted` | `rejected` | `failed` | `unknown` (`failed` only for a `plugin.call`).
- **Subscribe:** callback is `{msg, raw, duplicate}` (same as `onMessage`); acting code skips duplicates.
- **Live picture:** on-demand by default; opt-in live; on disconnect last snapshot readable as `stale: true` (ready may stay true).
- **Transports:** bytes-only adapters (`open` / `send` / `onData` / `onClose` / `close`).
- **Queue:** the Asset owns it; bodies are sent once, the order travels in `control.queue` (see [Queue](#queue)).
- **Identity:** one SDK module for keys-on-hello, `from`/`seq`/`time` stamp, and remember/dedupe; Core keeps a last-answer cache only.
- **Contact:** new post-hello messages with this Asset's `asset_id` whose `from` is not this Asset (not only `from: CORE`).
- **Stream items:** the inbound messages that match the query's own fields, once each, until its `admin.reply`. Core forwards live traffic as usual meanwhile; no correlation field. Core sends a history answer oldest first, and the finished result lists its items oldest first.
- **Reconnect:** Asset SDK auto-resynces in order describe → connect `report.settings` (each waiting for Core's `admin.reply`) → unacked finals → queue report; operator live picture rebuilds from Core's connect push; inflight request → `unknown`; no auto-retry of operator commands.
- **Handshake vs description:** hello = keys + id; `admin.describe` is keyless; `admin.asset` is removed.

## Offline Assets

- Core counts an Asset offline when it has heard nothing new from it for its `link_loss_after_s`, even while a link is open. An Asset that has been quiet for a third of that sends `report.telemetry` early, so its check-in carries data. Details: [communication.md](communication.md#when-core-counts-an-asset-offline).
- Commands, settings changes, lists and cancels for an offline Asset are refused and not held. The operator sends them again once the Asset is back.

## Review fixes

Selected corrections from a review before the SDK is built.

- **Facts can be cleared.** On an observation, `entity_type` or a detail set to `null` is no longer known. Left out still means unchanged.
- **Ellipses have a direction.** An uncertainty with `semi_minor_m` also gives `orientation_deg`. `semi_minor_m` is never larger than `semi_major_m`; the SDK's `check()` enforces that, because a schema can't compare two fields.
- **Ground elevation is above mean sea level.** The `ground_elevation` result is flat `altitude_m` with `altitude_reference` fixed to `msl`.
- **History in order.** Core sends a history answer oldest first, and the SDK's finished `stream` result lists its items by `time`. Live items may still arrive between them; they are true answers (see Stream items above).
- **Plugin calls in the SDK.** A `plugin.call` is a `stream`: its `plugin.result` items, then Core's `admin.reply`. A `failed` reply is its own outcome, and the items before it stand. Refused is `rejected`; no reply is `unknown`.
