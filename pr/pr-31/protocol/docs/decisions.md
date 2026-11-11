# Protocol decisions

The owner's choices about records that are not laws. When a definition and this
page disagree, fix one of them.

## Building blocks

- A **variable** (`definitions/variables/`) is one named field. A **component** (`definitions/components/`) groups variables that travel together, such as `altitude` (value plus reference), `position`, and `settings`. A **record** (`definitions/records/`) combines both.
- Each concept is defined once. There is one altitude definition, used by takeoff and by position.
- Each file is JSON Schema (2020-12), with a plain description and at least one example. `definitions/index.json` lists every file, so the CLI and viewer never hardcode one.

## Tasks

- A **command** is something an Asset can do: takeoff, move_to, land, return_to_home. A **Task** is one use of a command, or a settings change made when the Task runs (kind `settings`). [Every command is a Task](../../atlas/design-decisions.md#work-is-always-a-task).
- takeoff takes a target altitude. move_to takes a destination; without an altitude, the Asset keeps its current one. land takes a landing position and an optional transit altitude. return_to_home flies to the `home_position` setting.
- `return_to_home` is a command, and the same name is a failsafe response.
- There are no Plans. A queue is the list of an Asset's Tasks not started yet, in `task_id` order. Core numbers each Task and sends it once with its whole body, so the Asset never fetches a body and never receives a list to replace its own.
- A Task's state only moves forward, and a final state never changes.
- The description lists `commands`. Programs do not infer them from equipment. The list may be empty for a receive-only Asset such as an ADS-B receiver.

## Requests

- Request bodies live in `requests/`, apart from records. `requests.tasks` holds 1 to 64 Tasks, each a Task kind and its fields; with `now` it holds exactly one. `requests.settings` holds `settings`. A cancel has no body.
- A Task request item takes the Task record's kinds and adds nothing. Core stamps `time`, `asset_id`, `task_id`, `clear_count`, `send_last`, `now`, and `requested_by` to make each Task record.

## Settings

- Starting settings: `run_state` (paused or running), `lights`, `landing_gear`, `link_loss_response`, `low_battery_response` (the same list without continue), `link_loss_after_s`, `telemetry_every_s`, and `home_position`, where return_to_home goes. The Asset sets `home_position` where it starts up and an operator can move it. There are no custom per-Asset settings yet.
- A `settings_change` applies now, independently of the queue. A Task of kind `settings` applies when it runs.
- The description lists the settings an Asset supports, by name only, as it lists commands. Support is not a value: an Asset may support `home_position` before it knows one. There are no per-Asset value ranges. An Asset with no settings, such as a receive-only tracker, leaves the list out, so operators get no pause control for it.
- **Pause holds the active Task.** Setting `run_state` to `paused` leaves the active Task `active`, and it continues when `run_state` returns to `running`. The settings report's `run_state: paused` is the evidence of the hold, so there is no `paused` Task state. A Task that cannot continue fails with an explanation. Pause never cancels work the way `now` does. In failsafe state, pause holds the response Task the same way.

## Reports

- Reports are grouped under `report` and carry `type`, because Assets post them in mixed batches.
- `report.battery` is separate from telemetry, because the battery changes even when the Asset does not move.
- In `report.failsafe`, `kind` is the trigger, `link_loss` or `low_battery`. `response` is what the Asset does, from the same list as the response settings. A trigger and a response are different things, so they are never the same field.
- An older report never replaces a newer value. History keeps each report at its own time, even when it arrives late.
- A position with no altitude means the altitude was not measured. Displays draw it at ground level.
- One `entity_type` list names what Assets are, and will name observations and tracks.

## Administration and contact

- One `provisioning` record covers an Asset or a gateway being added or removed. The event kind says which, so the record does not. It names `asset_id` or `gateway_id`, and `requested_by`: the admin, or the gateway that added a radio Asset on first contact. What an Asset is comes from its description, not from provisioning.
- Key replacements, logins, and account changes have no shared record. They stay in Core's diagnostic log.
- One `contact` record says whether an Asset or gateway is `online` or `offline`. Its `time` is when it was last heard, so an offline record keeps that time and the record still has one time. Core uses it for `asset.contact`, and a gateway sends it for each Asset it carries, with its Fieldlink deciding online or offline.
- `requested_by` names an account or a gateway. Core keeps operator and gateway IDs distinct.

## Limits

- `type` and `kind` are each at most 32 characters.
- A position carries at most 4 altitudes, one per reference.

## Tools

The CLI and web viewer only display records. They show the readable JSON beside
the compact and compressed bytes in hex dump and base64, so you can inspect the size.

## Plugins

Plugin records are [parked](../parked/README.md) until they are reworked.
