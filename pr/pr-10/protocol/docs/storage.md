# Storage

How Core stores shared domain data, with one table per kind of thing. Field names
match the message fields. These tables are not the diagnostic transcript.
[Core logging](../../core/docs/logging.md) owns the separate local record of
messages, decisions, and errors used in Reset archives.

## Tables

| Table | One row per | Holds |
| --- | --- | --- |
| assets | Asset | `asset_id`, `entity_type`, key hash, `reports` and `commands` it supports, `cameras`, last heard time |
| tasks | Task | `asset_id`, `task_id`, the command or settings message that carried the `task_id`, its latest state (and `explanation` if it failed) |
| geofeatures | geo feature | the latest `geofeature.set` Core sent for it: `geofeature_id`, `kind`, `name`, its shape |
| objects | Object | its `object.describe`: `object_id`, `name`, `content_type`, `size_bytes`, `plugin_id`, `geofeature_id`; the file itself is stored beside the table |
| observations | observation | `asset_id`, `observation_id`, `kind`, the latest measurement (that kind's fields) and its time, `entity_type`, the latest value of each detail, `track_id` |
| tracks | track | `track_id`, `entity_type`, latest position and `uncertainty` if known, and time, its source observations |
| telemetry | telemetry report | `asset_id`, time, position, speed, heading (a time series) |
| history | stored report | `asset_id`, time, the report as received (status, failsafe, settings, battery) |

Latest status for supported queues, battery, and gimbal pointing is kept on the
Asset row or beside it. Settings retain each setting's newest confirmed value
and source report, ordered by the Asset's `time`, then `seq`. Supported settings
are separate from known values, under the selected
[startup model](communication.md#settings). Operator timestamps do not order
settings. No row has a revision or version counter.

Selected [subsystem conditions](../../asset/docs/status.md) likewise retain each
subsystem's last reported condition and source report independently. Partial
updates change only named subsystems. Core replays the reports needed to restore
those retained conditions, unchanged. Missing reports do not establish health.
The exact subsystem and settings-support records remain
[undefined](open-questions.md#unresolved), like the other stored record formats.

## Assets

An Asset row is created when the Asset first registers (see [Registration](#registration)). What it is (`entity_type`, if it says), its supported reports, commands and cameras come from `admin.describe`. Each camera says whether it is `fixed` or on a `gimbal`, which way it faces relative to the nose (`yaw_deg`, `pitch_deg`; for a gimbal, its rest direction) and its field of view, so an interface can draw what it sees. Live gimbal pointing comes from `report.gimbal`, which an Asset sends often while the gimbal is active and not at all while it is idle.

## Tasks

Core records what was asked; the Asset does it. A Task is the stored `control.command` or `control.settings` that carried a `task_id`, plus its latest `report.status` of kind `task`. Its state only moves forward, and finished states (completed, failed, cancelled) are final. A failed Task carries a reason. The order lives on the Asset; Core keeps its latest queue report. A `control.cancel` or `control.queue` is never stored as a Task.

## Geo features

A geo feature is a point, line or area made in Core by an operator or a Plugin: `geofeature_id`, `kind`, an optional `name` and its shape. Its row is the latest `geofeature.set` Core sent for it; a delete removes the row. Core picks the ID and never reuses one in a run, so it remembers the IDs it has used.

A command that uses a geo feature carries a copy of its shape and `geofeature_id` as a record (see [decisions](decisions.md#geo-features-and-objects)). The Task row keeps that record, and editing or deleting the geo feature never changes it. Geo features are not sent to Assets.

## Objects

An Object is a file Core holds, with its `object.describe`. Core picks the `object_id`, stores the file, then announces it; there is no half-stored Object. The file never changes: a different file is a new Object. An Object names at most one geo feature with `geofeature_id`, and the link is kept only there. A geo feature's Objects are the rows that name it. Objects are kept until Reset.

## Observations and tracks

Assets report observations (`report.observation`), never tracks. An Asset reuses the same `observation_id` while it keeps seeing the same target.

```
Asset ── report.observation ──▶ Core ──▶ [ fusion ] ──▶ tracks
```

Fusion decides when observations describe the same target, including when one Asset gives a target two IDs or several Assets see the same thing. Tasks that aim at a target name the track. Core owns the [fusion module and its planned first implementation](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/fusion.md).

An observation's `kind` says what the sensor measured. `coordinates` gives the target's position and its `uncertainty`. `bearing` gives the `origin` the sensor recorded when it saw the target, the bearing, and optionally elevation and range, each with its own uncertainty. `entity_type` and `details` stay true for an observation until a new value arrives, so Core keeps the latest of each.

The diagram shows the Observation path, not every possible fusion input.
Fusion can also use reference information such as DEM terrain elevation.
[Core fusion](../../core/docs/fusion.md) owns that behavior and its open choices.

A track holds what fusion decided: its `entity_type`, and a position with an `uncertainty` area once fusion can place it. As fusion combines observations, the area shrinks; it is often a polygon. Source-specific facts, such as a callsign, are not copied onto the track: displays read them from the track's latest source observation.

## Registration

Assets register themselves. No operator adds them first.
Core enforces [unique participant IDs](laws.md). Core-assigned IDs remain a
[proposal](open-questions.md#unresolved). The exchange below describes the current
definitions.

1. The deployment has one **enrollment key**, set in Core and given to the fleet.
2. A new Asset picks its own 4-character `asset_id` and makes its own random **asset key**.
3. When the link opens, the Asset presents its `asset_id`, its asset key and (the first time only) the enrollment key. These travel in its opening `admin.hello` and nowhere else.
4. If the enrollment key is right and the ID is free, Core stores the ID with a hash of the asset key. A taken ID is refused, and the Asset picks another.
5. From then on only that asset key works for that ID. A wrong key, or an unknown ID without the enrollment key, is refused.
6. Removing an Asset deletes its row. Changing the enrollment key stops new Assets from joining without affecting existing ones.

**Key size: 16 random bytes (128 bits), sent as 22 characters of base64url.** 128 random bits cannot be guessed: at a million tries per second it would take far longer than the age of the universe, and Core can also limit tries. Longer keys add no useful safety for a field network. Keys are sent once per link, in the opening hello, never in other messages, so the cost is 22 bytes per connection (44 the first time, with the enrollment key). The same size is used for both keys.

## History

History is first-class. `telemetry` and `history` are append-only and ordered by time: rows are added, never edited or removed during a run. An Asset's past path is its telemetry rows over a time range, asked for with one `query.core`:

```json
{"type":"query.core","time":1793667600000,"seq":43,"from":"OP1","asset_id":"A1","kind":"history","report":"telemetry","since":1793664000000,"until":1793667600000}
```

Core answers with the stored `report.telemetry` messages, oldest first.
