# Protocol working choices

Choices about the records that are not laws, made in design threads. They are
not owner decisions: any of them may change with a stated reason, in the same
pull request as the definitions. The owner's decisions are in the
[decision log](../../atlas/decision-log.md), which always wins. A bullet marked
*Owner decision* carries one of them: its rule is the log's, and only how the
records carry it is a working choice here. When a definition and this page
disagree, fix one of them.

## Building blocks

- A **variable** (`definitions/variables/`) is one named field. A **component** (`definitions/components/`) groups variables that travel together, such as `altitude` (value plus reference), `position`, and `settings`. A **record** (`definitions/records/`) combines both.
- Each concept is defined once. There is one altitude definition, used by takeoff and by position.
- Each file is JSON Schema (2020-12), with a plain description and at least one example. `definitions/index.json` lists every file, so the CLI and viewer never hardcode one.

## Tasks

- A **command** is something an Asset can do: takeoff, move_to, land, return_to_home, hold, failsafe. A **Task** is one use of a command, or a settings change made when the Task runs (kind `settings`). [Every command is a Task](../../atlas/design-decisions.md#work-is-always-a-task).
- takeoff takes a target altitude. move_to takes a destination; without an altitude, the Asset keeps its current one. land takes an optional landing position and an optional transit altitude; without a position, the Asset lands where it is when the Task starts. return_to_home flies to the `home_position` setting. hold stops the Asset where it is and completes once the hold is observed; the Asset then keeps holding, as it does with no Task to run. Hold is work, not pause: it keeps no earlier Task to resume. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).* failsafe fires the Asset's failsafe as if a rule had fired, running the rule with a `commanded` condition or, with none, the built-in safe action; it is always sent with `now`, completes once the Asset is in failsafe state, and is never a failsafe response. *[Owner decision](../../atlas/decision-log.md#failsafes).*
- **A Task keeps a copy of its place.** move_to and land may name a point geo feature by `geofeature_id`. The request gives only the ID; the Task record also carries the position Core copied when it accepted the Task, in `destination` or `landing_position`. A Task's body changes only when the operator who edits that place chooses to update its Tasks: Core sends the Task again with the same `task_id` and the new copy. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).*
- There are no Plans, only individual Tasks. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).* A queue is the list of an Asset's Tasks not started yet, in `task_id` order. Core numbers each Task and sends it once with its whole body, so the Asset never fetches a body and never receives a list to replace its own.
- A Task's state only moves forward, and a final state never changes.
- The description lists `commands`. Programs do not infer them from equipment. The list may be empty for a receive-only Asset such as an ADS-B receiver. It holds up to 16, room for every command kind with headroom for new ones; the check fails if it cannot hold them all.

## Requests

- Request bodies live in `requests/`, apart from records. `requests.tasks` holds 1 to 64 Tasks, each a Task kind and its fields; with `now` it holds exactly one. `requests.settings` holds `settings`. A cancel has no body. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).*
- `requests.asset` registers an Asset on IP: its description without `time` and `asset_id`. Core assigns the ID and stamps `time` to make the `description` record. It takes exactly the description record's other fields, with the same definitions; the check fails if they drift apart. A gateway signs up a radio Asset by sending its description record, with its `asset_id`. An Asset signs up only when its app starts, never on a reconnect.
- `requests.geofeature` creates or replaces a geo feature: a geo feature kind and its fields, and an optional `name`. Core stamps `time` and assigns `geofeature_id`.
- A Task request item takes the Task record's kinds and adds nothing. A Task that names a geo feature gives no position beside it. Core stamps `time`, `asset_id`, `task_id`, `clear_count`, `send_last`, `now`, and `requested_by` to make each Task record.

## Settings

- Starting settings: `run_state` (paused or running), `lights`, `landing_gear`, `link_loss_after_s`, `failsafe_policy`, `telemetry_every_s`, and `home_position`, where return_to_home goes. `link_loss_after_s` defines when the Asset counts contact as lost; it is not part of the policy. The Asset sets `home_position` where it starts up and an operator can move it. There are no custom per-Asset settings yet. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).*
- A `settings_change` applies now, independently of the queue. A Task of kind `settings` applies when it runs.
- The description lists the settings an Asset supports, by name only, as it lists commands. Support is not a value: an Asset may support `home_position` before it knows one. There are no per-Asset value ranges. An Asset with no settings, such as a receive-only tracker, leaves the list out, so operators get no pause control for it.
- **Pause keeps the active Task.** Setting `run_state` to `paused` leaves the active Task `active`, and it continues when `run_state` returns to `running`. The settings report's `run_state: paused` is the evidence of the pause, so there is no `paused` Task state. A Task that cannot continue fails with an explanation. Pause never cancels work the way `now` does. In failsafe state, pause keeps the response Task the same way. Pause is a setting; Hold is a command. *[Owner decision](../../atlas/decision-log.md#failsafes).*

## Reports

- Reports are grouped under `report` and carry `type`, because Assets post them in mixed batches.
- `report.battery` is separate from telemetry, because the battery changes even when the Asset does not move.
- `report.status` kind `subsystem` carries one subsystem's condition. There is no overall Asset condition. The description declares the subsystems, up to 16, each with an ID and a label, so a declared subsystem that has not reported shows as unreported, not healthy. *[Owner decision](../../atlas/decision-log.md#failsafes).*
- An older report never replaces a newer value. History keeps each report at its own time, even when it arrives late.
- A position with no altitude means the altitude was not measured. Displays draw it at ground level.
- One `entity_type` list names what Assets, Observations, and Tracks are.

## The shared picture

- **An Observation is the latest `report.observation`** for one `asset_id` and `observation_id`, ordered by report time and then `event_id`, as settings are. A report Core marks `clock_ahead` never becomes the latest. Earlier reports are history.
- **Observation reports are whole.** Each carries everything the Asset knows about the target, so a field left out is not known. Protocol never merges partial reports and has no `null` to clear a fact. Fieldlinks may avoid resending unchanged fields in their own encoding.
- **The Asset chooses `observation_id`**, unique for that Asset within a run, and keeps it while it keeps seeing the same target. Core assigns `track_id` and `geofeature_id`. *[Owner decision](../../atlas/decision-log.md#runs-and-identity).*
- **A `coordinates` Observation** says where the target is, with an optional uncertainty. **A `bearing` Observation** says which way it is from where the sensor was, with optional elevation and range.
- **A `track` is Fusion's conclusion.** Its `time` is the last sighting, the newest Observation report it uses. `sources` names the Observations it rests on. It has a position only when Fusion can place the target; a Track from bearings alone has none. Only Fusion writes Tracks. *[Owner decision](../../atlas/decision-log.md#the-picture-and-plugins).*
- **A `geofeature` is a point, line, area, or imagery, with an optional name**, and nothing else. A change replaces it whole. It names no author; the event that stores it carries `requested_by`.
- **Imagery names one GeoTIFF Object** by `object_id`. Its map position comes from the file, so the record carries no outline. A replacement may change only its name. *[Owner decision](../../atlas/decision-log.md#places-and-tasks).*
- No record carries a stale flag. Every record keeps its `time`, and readers show its age. *[Owner decision](../../atlas/decision-log.md#the-picture-and-plugins).*

## Failsafes

- **The policy is one setting.** `failsafe_policy` holds the Asset's complete list of rules, up to 16, and is always replaced whole, so it travels in `settings_change`, `report.settings`, and the Asset's starting settings. An empty list means no rules. The Asset checks a new policy whole and keeps its old one if any part is invalid or if it is in failsafe state; its `report.settings` answering the request shows the policy it kept. *[Owner decision](../../atlas/decision-log.md#failsafes).*
- **A rule** has a `rule_id`, a unique `priority` (higher wins), 1 to 8 conditions that must all hold, a response, and an optional fallback. Alternatives are separate rules.
- **Conditions** are kinds of `failsafe_condition`: `contact_lost`, `battery_below` a set percentage, `idle` for a time, `airborne`, `outside_area` by a margin for a time, `measurement_stale` for position or battery, `subsystem` at `degraded` (degraded or faulted) or `faulted`, and `commanded`, which holds when the operator's Fail-safe command arrives. A `battery_below` may be marked `critical`; every flying Asset, one whose description lists `takeoff`, needs a rule with a critical battery condition, and Core refuses Tasks to one without. *[Owner decision](../../atlas/decision-log.md#failsafes).* A low battery is a set percentage, never an estimate of the charge needed to get home, because a rule that waits for that estimate starts too late. *[Owner decision](../../atlas/decision-log.md#failsafes).*
- **Critical rules.** When several rules with a critical battery condition match, only the highest-priority one fires. If its response fails, the Asset returns home, and nothing is retried. *[Owner decision](../../atlas/decision-log.md#failsafes).* A critical rule therefore names no `fallback`, and the Asset refuses a policy in which one does. The return home runs as the rule's `fallback` attempt.
- **A response is a command.** It names a command kind the Asset lists, with its fields, never a settings change. A response is always protective. There is no `continue`: activation always cancels ordinary work, and a situation an Asset should keep working through is not a failsafe. *[Owner decision](../../atlas/decision-log.md#failsafes).*
- **Failsafe Tasks have no `task_id`.** Core owns the numbering, so `rule_id`, `attempt` (`primary` or `fallback`), and the report's `time` name a failsafe Task; a rule re-armed by an operator override may run more than once. The built-in safe action, run for the Fail-safe command when no rule applies, has no `rule_id`. `report.failsafe` kind `response` carries its state, and with `active` the response as it runs, parameters fixed: a land with no position names where it lands. `report.status` kind `task` stays for Core's numbered Tasks.
- `report.failsafe` kind `override` names the operator request that overrode a response: a Land, Return to home, or Hold Task sent with `now`, or a pause or running change. A Hold or pause override re-arms the contact-loss and low-battery rules, and a `battery_below` condition marked `critical` always fires, even after such an override. *[Owner decision](../../atlas/decision-log.md#failsafes).* Kind `autopilot` records an independent flight-controller protection taking over, without claiming Atlas started it. The first `report.failsafe` of an operation marks failsafe state.
- Refusals in failsafe state use existing reports: a refused Task is `failed` with the failsafe as its explanation, and a refused cancel or settings change is answered with the current Task state or settings, naming the request.

## Administration and contact

- **Registration and provisioning are separate records.** `registration` covers an Asset registering in the run or being removed from it, for `asset.registered` and `asset.removed`. It names the `asset_id` and `requested_by`: the gateway that registered a radio Asset, or the admin who removed it. An Asset on IP that registered itself has no `requested_by`. What an Asset is comes from its description. `provisioning` covers an admin adding or removing a gateway or Plugin. In both, the event kind says which, so the record does not. *[Owner decision](../../atlas/decision-log.md#runs-and-identity).*
- **Core assigns every `asset_id` at registration**, and Assets choose `observation_id` ([Runs and identity](../../atlas/runs-and-identity.md#ids)). `requests.radio` carries only the radio's definitions hash. *[Owner decision](../../atlas/decision-log.md#runs-and-identity).*
- Key replacements, logins, and account changes have no shared record. They stay in Core's diagnostic log.
- One `contact` record says whether an Asset or gateway is `online` or `offline`. Its `time` is when it was last heard, so an offline record keeps that time and the record still has one time. Core uses it for `asset.contact`, and a gateway sends it for each Asset it carries, with its Fieldlink deciding online or offline.
- `contact` names exactly one of `asset_id`, `gateway_id`, or `plugin_id`; `provisioning` names exactly one of `gateway_id` or `plugin_id`.
- `requested_by` names an account, a gateway, or a Plugin. Core keeps operator, gateway, and Plugin IDs distinct.
- **No record carries a radio identity.** It stays with the gateway and its Fieldlink; Core knows radio Assets only by `asset_id`. *[Owner decision](../../atlas/decision-log.md#runs-and-identity).*
- **No carrier record.** One gateway serves the whole radio network in an area, and no Asset uses two gateways, so the `registration` record's `requested_by` names it and no record moves an Asset between gateways. *[Owner decision](../../atlas/decision-log.md#runs-and-identity).*
- One `drop` record covers `task.dropped`, `request.dropped`, and `plugin.dropped`; `refusal` records `definitions.refused`; a radio's refusal names its gateway with `radio` set. The event kind says which drop, as for `registration`.

## Definitions hash

- **The hash covers every definition file byte for byte**, descriptions and examples included, so programs agree only when they load the same files. A wording fix gives a new hash; programs take definitions from the same Protocol package release, so they move together.
- **Recipe.** Take every `.json` file in `definitions/`, `index.json` included. Name each by its path relative to `definitions/`, with `/` between folders, and sort the paths by their UTF-8 bytes. For each file in that order, append its path, a newline (byte `0x0A`), its length in bytes as a decimal number, a newline, and then its exact bytes. The hash is SHA-256 of the result, written as `sha256:` and 64 lowercase hex digits.
- **Test vector.** Two files: `index.json` holding the 14 bytes `{"title":"T"}` and a newline, and `variables/a_id.json` holding the 17 bytes `{"title":"a_id"}` and a newline. The input is `index.json\n14\n{"title":"T"}\nvariables/a_id.json\n17\n{"title":"a_id"}\n`, where `\n` is one newline byte, and its hash is `sha256:b393b32791af143e2e3f7b210546be519504aca5204b2bf1ecad03303c640209`.

## Limits

- `type` and `kind` are each at most 32 characters.
- A position carries at most 4 altitudes, one per reference.

## Tools

The CLI and web viewer only display records. They show the readable JSON beside
the compact and compressed bytes in hex dump and base64, so you can inspect the size.

## Objects and Plugins

- The `object` record is `object_id`, `name`, `content_type`, `size_bytes`, an
  optional `geofeature_id`, and `requested_by`, the account or Plugin that
  stored it. `deletion` records an operator deleting one; the Object is hidden, not destroyed. *[Owner decision](../../atlas/decision-log.md#the-picture-and-plugins).*
- **Plugins describe their own actions.** `plugin.description` lists each
  action by name, with a label, optional `help_text`, and its inputs, each a
  `plugin_input` that names one of the fixed `input_kind` values. Its display
  choices are `in_menu` and `show_on_map`, both false when left out. *[Owner decision](../../atlas/decision-log.md#the-picture-and-plugins).* A call carries one `input_value` per
  input given. Protocol does not list actions, so a new Plugin or action needs
  no Protocol change; a new input kind does.
- **Every action answers the same way.** `plugin.result` holds `places`
  (bodies of geo features listed, not stored), `facts` (a label and a text
  value), and the `geofeature_ids` and `object_ids` the Plugin created. All are
  optional, so an empty result means nothing was found. `plugin.failure` holds
  an `explanation` and what was already created. Each list holds at most 1000
  items; a Plugin with more fails rather than answering in part. *[Owner decision](../../atlas/decision-log.md#the-picture-and-plugins).*
- The Plugin records are grouped under `plugin`, with `type`, because one
  answer call takes either a result or a failure.
