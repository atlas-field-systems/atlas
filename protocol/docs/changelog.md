# Changelog

## 0.8

- No short keys: field names and `type` stay readable for good (law 6). Each link chooses its own compression; the hello and its reply are never compressed (law 12). Every change after a release is a new version, additive or not (law 10). No message changes.
- Observations: `report.observation` has kinds `coordinates` (target position with `uncertainty`) and `bearing` (recorded `origin`, bearing, optional elevation and range, each with an uncertainty). New shared `entity_type` on observations and, optionally, `admin.describe`. New `details` with a fixed list (`icao_address`, `callsign`, `squawk`, `color`). New components `uncertainty` (ellipse or polygon, 95% bounds, law 8) and `point`.
- Plugins: new `plugin` group. `plugin.describe` lists one Plugin's actions; Core sends one per Plugin on operator connect and in answer to new `query.core` kind `plugins`. `plugin.call` runs an action (a kind); Core answers one `plugin.result` per item (from `CORE`, naming the call with `reply_from` + `reply_to`), then `admin.reply`. New `reply_result` value `failed`: the Plugin ran and broke. New variables `plugin_id` and `action`. First action: `ground_elevation` (a position in, an altitude above mean sea level out). Law 15 and law 21 extended to Plugin actions.
- Origin: every message carries `from` (Asset id, operator id, or `CORE`). Core forwards other creators' messages unchanged. Duplicates are `(from, seq, time)`. Replies use `reply_from` + `reply_to`. Law 2 changed on purpose (flat messages with a creator).
- Handshake split: `admin.hello` is keys + version + id only. New keyless `admin.describe` carries reports, commands and cameras. `admin.asset` removed.
- Queue: drop `task_seq` and the gap-wait. Core owns an ordered list of `task_id`s; Asset reports the queue; Core resends missing bodies.
- SDK how-it-works locked under `sdk/`: shared `check()`, `request`/`stream`/`subscribe`, on-demand picture with opt-in live + `stale`, bytes-only adapters, one identity module, Asset auto-resync, no operator command auto-retry.
- Dedupe: act once, deliver always. A replayed message is not acted on again but is still delivered to streams, subscribers and the live picture; the picture upserts by `(from, seq, time)`.
- Asset reconnect order: after each accepted hello, describe → connect `report.settings` → unacked finals → queue report → `query.queue`.
- Acknowledgements (law 23): Core acknowledges `admin.describe` and the connect `report.settings` with `admin.reply`; the Asset resends each until acknowledged and sends nothing else first.
- A cancel that changes no setting is answered with `run_state` unchanged. While paused, a new immediate command runs but queued tasks wait for `run_state: running`. Link loss counts on the ground; every response except `continue` keeps the Asset down and cancels its queue.
- Offline Assets: Core counts an Asset offline after `link_loss_after_s` with nothing new from it, even with a link open. A quiet Asset sends `report.telemetry` early. Core refuses and holds nothing for an offline Asset, and stops resending Tasks it never saw confirmed once the Asset goes offline.
- Link loss contact: any new (non-duplicate) message after the accepted hello that names this Asset in `asset_id` and was not sent by this Asset (not only `from: CORE`). Covers Core forwards of operator traffic.
- Task order: Core sends a task only after the Asset has shown it holds the one before, so tasks arrive in Core's order. A task reported cancelled with no cancel passed on by Core means the queue was cleared, and Core drops the tasks it has not sent.
- A failed task or a failsafe (except `continue`) also sets `run_state` paused, so a task that arrives afterwards waits for `run_state: running`. When Core passes on a motion command without `task_id`, it cancels each task it sent that the Asset has not shown it holds.
- Observation facts: `entity_type`, `icao_address`, `callsign`, `squawk` and `color` accept `null`, meaning no longer known. Uncertainty: `semi_minor_m` requires `orientation_deg`.
- `plugin.result` kind `ground_elevation` is flat `altitude_m` with `altitude_reference` fixed to `msl` (was an `elevation` object that accepted any reference).
- History: Core sends a history answer oldest first.
- Geo features and Objects: new `geofeature` group, `geofeature.set` (kinds `point`, `line`, `area`; whole end state; no ID creates one) and `geofeature.delete`. New `object` group, `object.describe` (a file Core holds; the file is fetched over HTTP, never in a message). Core picks `geofeature_id` and `object_id` and never reuses one in a run; `admin.reply` gains `geofeature_id`. Core pushes every geo feature and Object on operator connect. An Object names at most one geo feature. `move_to` and `land` take an optional `geofeature_id` as a record of where the position came from; the Asset ignores it. New components `line` and `area` (`uncertainty` polygons are an `area` now), new variables `name`, `content_type`, `size_bytes`.
- New task state `undelivered`, set only by Core for a task it gave up delivering (dropped unsent, or never shown before the Asset went offline). Not final; the Asset's later report replaces it. A queued `control.settings` is confirmed with `report.settings` naming it.
- Home: new setting `home_position`, where `return_to_home` goes. The Asset sets it to where it starts up (every Asset has GPS) and an operator can move it. `land_at_position` and the failsafe response `land_at` are removed. `altitude_reference` `home` is renamed `launch` (where the Asset last took off), so moving home never changes what an altitude means.
- Settings are grouped: `report.settings` and `control.settings` carry them in one `settings` object, the new `settings` component, which lists each setting once. Law 2 says a component may group fields that belong together.
- Ready: Core counts an Asset ready once it has acknowledged the connect report. Until then Core sends it no Task and refuses `control.*` for it (law 23).
- Examples no longer need a version bump; only definitions and storage do (law 10).
- `task_id`: the operator interface picks it; Core refuses one that Asset already had in the run, and the interface picks another.

## 0.7

- Duplicates: a message is identified by `(sender, seq, time)`. A retry is the same message unchanged and gets the same answer again. The "lower hello means restart" rule is removed. Core keeps its `seq` across restarts. A sender's clock never goes backwards and it sends nothing before its clock is set.
- Task states only move forward; the first final state stays. Late or contradicting reports change nothing.
- The Asset resends a Task's final report until Core acknowledges it with `admin.reply`, which now carries the `task_id`. Core resends a Task only while the Asset has never shown it holds it. An Asset never runs a `task_id` twice and remembers at least its last 1024 finished Tasks. The queue report includes the running Task.
- `control.cancel` never creates a Task. Core refuses an unknown or finished `task_id`. Cancelling a queued Task leaves the running one alone. A cancel that arrives before its Task is remembered.
- Settings: the connect report lists every supported setting; later reports may be partial, and a setting left out is unchanged. Per setting the newest `time` wins; an Asset never sends two settings reports with the same `time`.
- Link loss: contact means new messages from Core. New `admin.alive`, sent by Core when it has sent nothing new for a while. New setting `link_loss_after_s` (30 s unless set). With `link_loss_response: continue` the Asset keeps its Task and queue.

## 0.6

- Keys move from the link opening into the opening hello: `key` (and `enrollment_key` the first time) on `admin.hello`, `key` on `admin.operator_hello`. `key` is required on both. Keys appear in no other message, and Core never sends one: it shares an Asset's hello with operators as the new `admin.asset`, which has no key fields. New `hello_result` `refused`.
- The hello must come first. One link per ID: a newer link with the same `asset_id` or `operator_id` replaces the older.
- Everything a sender sends gets a new `seq`; Core puts its own `seq` on forwarded reports and on each `every_s` repeat.
- A query's `admin.reply` comes after its answer and marks the end; an accepted reply alone means nothing matched.
- Commands to an Asset that is not connected are refused.
- New setting `telemetry_every_s`.

## 0.5

- Operator API: one WebSocket per operator interface, same messages, pushed both ways. New `admin.operator_hello` and `operator_id`; the key travels with the link opening, like an asset key.
- `admin.hello_reply` names the Asset or the operator interface.
- New `admin.reply`: Core's `accepted` or `refused` (with `explanation`) to every operator message.
- Routing is the link's job. Receivers drop a repeated `(sender, seq)`.
- New example: operator session.

## 0.4

- Tasks carry `task_seq`. Assets wait (bounded) at a gap, then `query.queue`; a repeated `task_id` does nothing.
- `admin.hello` `commands` may be empty (receive-only Assets, such as an ADS-B receiver).
- An immediate motion command cancels the rest of the queue. Settings stay immediate.
- New `control.cancel`: stop a Task or the motion running now; the Asset holds and pauses.
- New command `return_to_home`. The failsafe response `return_home` is renamed `return_to_home`.
- Failsafe responses: `continue`, `hold`, `land`, `return_to_home`, `land_at`. New settings `low_battery_response` (no `continue`) and `land_at_position`.
- History: append-only log in storage, and `query.core` history for an Asset's past path.

## 0.3

- Nested message groups, query group, `hello` reports and commands, storage, cameras, observations and self-registration.
