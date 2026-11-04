# Storage

How Core stores what it knows. A normal store with one table per kind of thing. Core does not keep a raw log of every message. Field names match the message fields.

## Tables

| Table | One row per | Holds |
| --- | --- | --- |
| assets | Asset | `asset_id`, key hash, `reports` it supports, `cameras`, last heard time |
| tasks | Task | `asset_id`, `task_id`, the command or settings message that carried the `task_id`, its latest state (and `explanation` if it failed) |
| geofeatures | geo feature | `geofeature_id`, kind, geometry (a point, line or area) |
| observations | observation | `asset_id`, `observation_id`, latest position and time, `track_id` |
| tracks | track | `track_id`, its source observations, latest position and time |
| telemetry | telemetry report | `asset_id`, time, position, speed, heading (a time series) |
| history | stored report | `asset_id`, time, the report as received (status, failsafe, settings, battery) |

Latest status, battery, settings and gimbal pointing are kept on the asset row or beside it, newest only. No row has a revision or version counter.

## Assets

An Asset row is created when the Asset first registers (see [Registration](#registration)). Its supported reports and cameras come from `admin.hello`. Each camera says whether it is `fixed` or on a `gimbal`, which way it faces relative to the nose (`yaw_deg`, `pitch_deg`; for a gimbal, its rest direction) and its field of view, so an interface can draw what it sees. Live gimbal pointing comes from `report.gimbal`, which an Asset sends often while the gimbal is active and not at all while it is idle.

## Tasks

Core records what was asked; the Asset does it. A Task is the stored `control.command` or `control.settings` that carried a `task_id`, plus its latest `report.status` of kind `task`. Finished states (completed, failed, cancelled) are final. A failed Task carries a reason.

## Geo features

A geo feature is `{geofeature_id, kind, geometry}`, made by an operator in Core. `move_to` stays simple and never names a geo feature; how Tasks link to geo features is an open question. Editing a geo feature never changes a command already sent. Geo features are not sent over the Asset link on their own.

## Observations and tracks

Assets report observations (`report.observation`), never tracks. An Asset reuses the same `observation_id` while it keeps seeing the same target.

```
Asset ── report.observation ──▶ Core ──▶ [ fusion ] ──▶ tracks
```

Fusion is its own swappable module, run in Docker like the other Core pillars. Core passes observations in and tracks come out; what happens inside is up to the module, including when one Asset gives a target two IDs or several Assets see the same thing. The first iteration uses a temporary fusion module that turns every new `asset_id` + `observation_id` pair into its own track (listing its source), to find the Core/fusion boundary and make debugging easy. Tasks that aim at a target name the track. Observation types (person, vehicle, and so on) are deferred.

## Registration

Assets register themselves. No operator adds them first.

1. The deployment has one **enrollment key**, set in Core and given to the fleet.
2. A new Asset picks its own 4-character `asset_id` and makes its own random **asset key**.
3. When the link opens, the Asset presents its `asset_id`, its asset key and (the first time only) the enrollment key. These travel with the link opening (for example the WebSocket connection request), not inside `admin.hello`.
4. If the enrollment key is right and the ID is free, Core stores the ID with a hash of the asset key. A taken ID is refused, and the Asset picks another.
5. From then on only that asset key works for that ID. A wrong key, or an unknown ID without the enrollment key, is refused.
6. Removing an Asset deletes its row. Changing the enrollment key stops new Assets from joining without affecting existing ones.

**Key size: 16 random bytes (128 bits), sent as 22 characters of base64url.** 128 random bits cannot be guessed: at a million tries per second it would take far longer than the age of the universe, and Core can also limit tries. Longer keys add no useful safety for a field network. Keys are sent once per link opening, never in each message, so the cost is 22 bytes per connection (44 the first time, with the enrollment key). The same size is used for both keys.

## History

History is first-class. `telemetry` and `history` are append-only and ordered by time: rows are added, never edited or removed during a run. An Asset's past path is its telemetry rows over a time range, asked for with one `query.core`:

```json
{"type":"query.core","time":1793667600000,"seq":43,"asset_id":"A1","kind":"history","report":"telemetry","since":1793664000000,"until":1793667600000}
```

Core answers with the stored `report.telemetry` messages, oldest first.
