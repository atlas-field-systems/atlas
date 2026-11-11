# Protocol decisions

The owner's choices about records that are not laws. When a definition and this
page disagree, fix one of them.

## Building blocks

- A **variable** (`definitions/variables/`) is one named field. A **component** (`definitions/components/`) groups variables that travel together, such as `altitude` (value plus reference), `position`, and `settings`. A **record** (`definitions/records/`) combines both.
- Each concept is defined once. There is one altitude definition, used by takeoff and by position.
- Each file is JSON Schema (2020-12), with a plain description and at least one example. `definitions/index.json` lists every file, so the CLI and viewer never hardcode one.

## Tasks

- A **command** is something an Asset can do: takeoff, move_to, land, return_to_home, hold. A **Task** is one use of a command, or a settings change made when the Task runs (kind `settings`). [Every command is a Task](../../atlas/design-decisions.md#work-is-always-a-task).
- takeoff takes a target altitude. move_to takes a destination; without an altitude, the Asset keeps its current one. land takes an optional landing position and an optional transit altitude; without a position, the Asset lands where it is when the Task starts. return_to_home flies to the `home_position` setting. hold stops the Asset where it is and completes once the hold is observed; the Asset then keeps holding, as it does with no Task to run. Hold is work, not pause: it keeps no earlier Task to resume.
- There are no Plans. A queue is the list of an Asset's Tasks not started yet, in `task_id` order. Core numbers each Task and sends it once with its whole body, so the Asset never fetches a body and never receives a list to replace its own.
- A Task's state only moves forward, and a final state never changes.
- The description lists `commands`. Programs do not infer them from equipment. The list may be empty for a receive-only Asset such as an ADS-B receiver.

## Requests

- Request bodies live in `requests/`, apart from records. `requests.tasks` holds 1 to 64 Tasks, each a Task kind and its fields; with `now` it holds exactly one. `requests.settings` holds `settings`. A cancel has no body.
- `requests.geofeature` creates or replaces a geo feature: a geo feature kind and its fields, and an optional `name`. Core stamps `time` and assigns `geofeature_id`.
- A Task request item takes the Task record's kinds and adds nothing. Core stamps `time`, `asset_id`, `task_id`, `clear_count`, `send_last`, `now`, and `requested_by` to make each Task record.

## Settings

- Starting settings: `run_state` (paused or running), `lights`, `landing_gear`, `link_loss_after_s`, `failsafe_policy`, `telemetry_every_s`, and `home_position`, where return_to_home goes. `link_loss_after_s` defines when the Asset counts contact as lost; it is not part of the policy. The Asset sets `home_position` where it starts up and an operator can move it. There are no custom per-Asset settings yet.
- A `settings_change` applies now, independently of the queue. A Task of kind `settings` applies when it runs.
- The description lists the settings an Asset supports, by name only, as it lists commands. Support is not a value: an Asset may support `home_position` before it knows one. There are no per-Asset value ranges. An Asset with no settings, such as a receive-only tracker, leaves the list out, so operators get no pause control for it.
- **Pause holds the active Task.** Setting `run_state` to `paused` leaves the active Task `active`, and it continues when `run_state` returns to `running`. The settings report's `run_state: paused` is the evidence of the hold, so there is no `paused` Task state. A Task that cannot continue fails with an explanation. Pause never cancels work the way `now` does. In failsafe state, pause holds the response Task the same way.

## Reports

- Reports are grouped under `report` and carry `type`, because Assets post them in mixed batches.
- `report.battery` is separate from telemetry, because the battery changes even when the Asset does not move.
- `report.status` kind `subsystem` carries one subsystem's condition. There is no overall Asset condition. The description declares the subsystems, up to 16, each with an ID and a label, so a declared subsystem that has not reported shows as unreported, not healthy.
- An older report never replaces a newer value. History keeps each report at its own time, even when it arrives late.
- A position with no altitude means the altitude was not measured. Displays draw it at ground level.
- One `entity_type` list names what Assets, Observations, and Tracks are.

## The shared picture

- **An Observation is the latest `report.observation`** for one `asset_id` and `observation_id`, ordered by report time and then `event_id`, as settings are. A report Core marks `clock_ahead` never becomes the latest. Earlier reports are history.
- **Observation reports are whole.** Each carries everything the Asset knows about the target, so a field left out is not known. Protocol never merges partial reports and has no `null` to clear a fact. Fieldlinks may avoid resending unchanged fields in their own encoding.
- **The Asset chooses `observation_id`**, unique for that Asset within a run, and keeps it while it keeps seeing the same target. Core assigns `track_id` and `geofeature_id`.
- **A `coordinates` Observation** says where the target is, with an optional uncertainty. **A `bearing` Observation** says which way it is from where the sensor was, with optional elevation and range.
- **A `track` is Fusion's conclusion.** Its `time` is the last sighting, the newest Observation report it uses. `sources` names the Observations it rests on. It has a position only when Fusion can place the target; a Track from bearings alone has none. Only Fusion writes Tracks.
- **A `geofeature` is a point, line, area, or imagery, with an optional name**, and nothing else. A change replaces it whole. It names no author; the event that stores it carries `requested_by`.
- **Imagery names one GeoTIFF Object** by `object_id`. Its map position comes from the file, so the record carries no outline. A replacement may change only its name.
- No record carries a stale flag. Every record keeps its `time`, and readers show its age.

## Failsafes

- **The policy is one setting.** `failsafe_policy` holds the Asset's complete list of rules, up to 16, and is always replaced whole, so it travels in `settings_change`, `report.settings`, and the Asset's starting settings. An empty list means no rules. The Asset checks a new policy whole and keeps its old one if any part is invalid or if it is in failsafe state; its `report.settings` answering the request shows the policy it kept.
- **A rule** has a `rule_id`, a unique `priority` (higher wins), 1 to 8 conditions that must all hold, a response, and an optional fallback. Alternatives are separate rules.
- **Conditions** are kinds of `failsafe_condition`: `contact_lost`, `battery_below` a set percentage, `idle` for a time, `airborne`, `outside_area` by a margin for a time, `measurement_stale` for position or battery, and `subsystem` at `degraded` (degraded or faulted) or `faulted`. A low battery is a set percentage, never an estimate of the charge needed to get home, because a rule that waits for that estimate starts too late.
- **A response is a command.** It names a command kind the Asset lists, with its fields, never a settings change. There is no `continue`: activation always cancels ordinary work, and an Asset that should keep working has no rule for that situation.
- **Failsafe Tasks have no `task_id`.** Core owns the numbering, and each rule runs at most once in an operation, so `rule_id` and `attempt` (`primary` or `fallback`) name a failsafe Task. `report.failsafe` kind `response` carries its state, and with `active` the response as it runs, parameters fixed: a land with no position names where it lands. `report.status` kind `task` stays for Core's numbered Tasks.
- `report.failsafe` kind `override` names the operator request that overrode a response. Kind `autopilot` records an independent flight-controller protection taking over, without claiming Atlas started it. The first `report.failsafe` of an operation marks failsafe state.
- Refusals in failsafe state use existing reports: a refused Task is `failed` with the failsafe as its explanation, and a refused cancel or settings change is answered with the current Task state or settings, naming the request.

## Administration and contact

- One `provisioning` record covers an Asset, gateway, or Plugin being added or removed. The event kind says which, so the record does not. It names its ID and `requested_by`: the admin, or the gateway that added a radio Asset on first contact. What an Asset is comes from its description, not from provisioning.
- Key replacements, logins, and account changes have no shared record. They stay in Core's diagnostic log.
- One `contact` record says whether an Asset or gateway is `online` or `offline`. Its `time` is when it was last heard, so an offline record keeps that time and the record still has one time. Core uses it for `asset.contact`, and a gateway sends it for each Asset it carries, with its Fieldlink deciding online or offline.
- `provisioning` and `contact` name exactly one of `asset_id`, `gateway_id`, or `plugin_id`.
- `requested_by` names an account, a gateway, or a Plugin. Core keeps operator, gateway, and Plugin IDs distinct.
- **No record carries a radio identity.** It stays with the gateway and its Fieldlink; Core knows radio Assets only by `asset_id`.
- `carrier` records which gateway carries a radio Asset, or none, for `asset.carried`.
- One `drop` record covers `task.dropped`, `request.dropped`, and `plugin.dropped`; `refusal` records `definitions.refused`. The event kind says which drop, as for `provisioning`.

## Limits

- `type` and `kind` are each at most 32 characters.
- A position carries at most 4 altitudes, one per reference.

## Tools

The CLI and web viewer only display records. They show the readable JSON beside
the compact and compressed bytes in hex dump and base64, so you can inspect the size.

## Objects and Plugins

- The `object` record is `object_id`, `name`, `content_type`, `size_bytes`, an
  optional `geofeature_id`, and `requested_by`, the account or Plugin that
  stored it. `deletion` records an operator deleting one.
- **Plugins describe their own actions.** `plugin.description` lists each
  action by name, with a label, optional `help_text`, and its inputs, each a
  `plugin_input` that names one of the fixed `input_kind` values. Its display
  choices are `in_menu` and `show_on_map`, both false when left out. A call carries one `input_value` per
  input given. Protocol does not list actions, so a new Plugin or action needs
  no Protocol change; a new input kind does.
- **Every action answers the same way.** `plugin.result` holds `places`
  (bodies of geo features listed, not stored), `facts` (a label and a text
  value), and the `geofeature_ids` and `object_ids` the Plugin created. All are
  optional, so an empty result means nothing was found. `plugin.failure` holds
  an `explanation` and what was already created. Each list holds at most 1000
  items; a Plugin with more fails rather than answering in part.
- The Plugin records are grouped under `plugin`, with `type`, because one
  answer call takes either a result or a failure.
