# Decision log

The owner's product decisions, newest first. This page is authoritative: when
another page disagrees with it, that page is wrong. Each entry names its scope,
so a rule is never stretched past it, and the one page that owns the detail.

Only the owner adds or changes an entry. A thread's recommendation is not a
decision until the owner makes it. Atlas is still a [draft](CHARTER.md#everything-is-a-draft),
so any entry may be reversed. A reversal updates this log and, in the same pull
request, every page that still teaches the old rule, and adds the old wording to
the [retired phrases](https://github.com/atlas-field-systems/atlas/blob/main/.github/retired-phrases.json) so CI catches it coming
back.

Dates are when the owner decided (America/New_York).

## Runs and identity

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | Every run starts the picture fresh. Across runs, every Asset registers again and comes back as a new Asset with a new ID that Core assigns; the acknowledgement tells it the ID. Nothing picks its own `asset_id`. `observation_id` stays Asset-chosen. Assets on IP work the same way: the admin hands out only the access key. | Across runs. Within a run, IDs stay. | [Runs and identity](runs-and-identity.md#ids) |
| 2026-11-11 | Each access key registers at most one Asset at a time. Reconnecting with the same key in the same run returns the same `asset_id`, unless an admin removed that Asset. | Within one run. | [Runs and identity](runs-and-identity.md#keys-and-registration) |
| 2026-11-11 | No advance radio setup. A radio registers when the gateway first hears it in a run. A removed radio can register again as a new Asset. | Radio Assets, within a run. | [Runs and identity](runs-and-identity.md#radio-assets) |
| 2026-11-11 | Mid-run gateway swap: radios stay the same Assets, tell the new gateway who they are, and keep their IDs and unfinished work. A gateway removed and not replaced leaves its radio Assets offline but still the same Assets. Takeover happens only when the old carrier is offline, removed, or none. | Within a run. A new run still gives new IDs. | [Runs and identity](runs-and-identity.md#when-the-gateway-changes) |
| 2026-11-11 | Radio identity is dropped from Core. The gateway is an IP bridge; edge identity stays on the gateway side. One gateway per site. | Core and the records. A Fieldlink still gives each radio its own identity. | [Gateway](https://github.com/atlas-field-systems/atlas/blob/main/gateway/README.md#what-every-fieldlink-provides) |
| 2026-11-11 | Carried between runs: accounts, connection keys, and installed Plugin setup. Not carried: Asset IDs, the run's picture, and operator state. | Across runs. | [Runs and identity](runs-and-identity.md#what-carries-over) |
| 2026-11-11 | Stopping Core is Reset; there is no separate Reset button. After Core stops, everyone signs in again. Leftover operator state (shared links, hidden tracks, sessions) is discarded, and links belong to one run. | Across runs. | [Runs and identity](runs-and-identity.md#a-run-and-reset) |
| 2026-11-11 | No retention. Once the Reset ZIP checks out, the run's data is deleted from Core; the ZIP is the only copy and is never deleted automatically. A run whose ZIP failed is never served through the Core API. | Across runs. Within a run, nothing in the picture expires. | [Core Reset](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/reset.md#check-then-clear) |

## Places and Tasks

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | A Task holds a live reference to a place (`geofeature_id`). The Asset obtains the current shape; Core never copies or snapshots it. Assets get read access to the named place only. Edits reach the Asset as `geofeature.replaced` or `geofeature.deleted`. | A named place. A shape drawn into one Task is carried by that Task. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-11 | Place edits and deletes go through while Tasks use the place. Core blocks nothing and cancels nothing; each Asset may keep its original plan or follow the new shape. | Places named by unfinished Tasks. | [Asset behavior](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#carry-out-work-and-report-its-result) |
| 2026-11-11 | Core refuses a place that is not a point for `move_to` and `land`. | Those two commands. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-11 | Imagery is a fourth place kind, beside point, line, and area. It can only be renamed. The imagery must be deleted before the file it shows (`409` otherwise). Photo detection is removed. | Places and Objects. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-10 | The Task cap is 64 ordinary Tasks; a `now` Task is admitted even at 64. | Per Asset, outstanding work. | [Core API, operator requests](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#operator-requests) |
| 2026-11-10 | Hold is an ordinary command, like Land. It is not pause: it keeps no earlier Task to resume. | Commands. Pause stays a setting. | [Protocol decisions](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/decisions.md#tasks) |

## Failsafes

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | Failsafe boundaries are drawn separately from saved places; a failsafe response can't name a saved place. | Failsafe rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#configure-conditions-as-well-as-responses) |
| 2026-11-11 | Up to 16 failsafe rules and 16 pieces of equipment (subsystems) per Asset. | Per Asset. | [Protocol decisions](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/decisions.md#failsafes) |
| 2026-11-10 | Any operator may change failsafe rules. | Outside failsafe state. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#replace-the-policy-during-ordinary-operation) |
| 2026-11-10 | Low battery is a set percentage, not an estimate of the charge needed to get home. | Battery rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#configure-conditions-as-well-as-responses) |
| 2026-11-10 | A failsafe rule may react to degraded or faulted equipment. | Declared subsystems. | [Subsystem conditions](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/status.md#reports-describe-equipment) |

## The picture and Plugins

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | Plugins choose how they appear: `help_text`, `in_menu`, and `show_on_map`, with menu and map off unless set. They should be really easy to configure and describe their own actions. | Plugin descriptions. | [Plugins](plugins.md#actions) |
| 2026-11-11 | A right-click action appears only when the action has exactly one input of the clicked kind. | The map's right-click menu. | [Plugins in the interface](https://github.com/atlas-field-systems/atlas/blob/main/command-interface/docs/plugins-and-objects.md#new-plugins-need-no-interface-change) |
| 2026-11-10 | A Plugin's rights over geo features are create-only. Plugin-suggested routes and repeating Plugin calls are out of scope. | Plugins. | [Plugins](plugins.md#not-plugins) |
| 2026-11-10 | Tracks come only from Fusion. Old Observations and Tracks stay in the picture for the whole run; Core adds no stale flag. | Within a run. | [Core API, Entities](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#entities) |

## How work lands

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | Merges are local `git merge --no-ff` commits under the project's noreply identity, then a normal push; `gh pr merge` rejects that address. | This repository. | [AGENTS.md](https://github.com/atlas-field-systems/atlas/blob/main/AGENTS.md#working-rules) |
