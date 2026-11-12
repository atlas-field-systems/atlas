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
| 2026-11-12 | If an Asset's or gateway's Reset ZIP fails, it keeps the records and tells whoever runs it, as Core does. It does not try again at its next start. | Asset and gateway Reset ZIPs. | [Asset logging](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/logging.md#export-the-assets-reset-zip) |
| 2026-11-12 | If the Reset ZIP fails, Core keeps the run's data and tells the admin. It does not try again at later starts. A crash while Core is stopping on purpose just resumes the run. | Core Reset. | [Core Reset](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/reset.md#when-the-zip-fails) |
| 2026-11-12 | Results an Asset app had not reported before it was started again on the ground are lost; nothing keeps them. When it signs up again, Core marks its Tasks with no final report not done, claiming no outcome. | An app restart during a run, on the ground. | [Runs and identity](runs-and-identity.md#keys-and-registration) |
| 2026-11-12 | A radio Asset whose app starts again signs up again through its gateway, like any Asset. There is no separate gateway restart signal. | Radio Assets, within one run. | [Runs and identity](runs-and-identity.md#radio-assets) |
| 2026-11-12 | If Core ever runs out of Asset IDs, it refuses new registrations and tells the admin. Asset IDs are never reused, not even in a later run. | Registration, in every run. | [Runs and identity](runs-and-identity.md#ids) |
| 2026-11-11 | An unplanned Core crash or reboot resumes the same run: the same run, the same Asset IDs, and the same Task numbering. Operators reconnect. Only a deliberate stop of Core is Reset. | Core crashes and power loss during a run. | [Runs and identity](runs-and-identity.md#a-run-and-reset) |
| 2026-11-11 | Nothing restarts the Asset app on its own. If the app or its companion computer fails in the air, it stays down and operators see the Asset offline. The flight controller detects the loss and returns home by itself, independent of Atlas. The vehicle is inspected before its next flight. | An app or companion-computer failure in flight. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#if-the-app-fails-in-flight) |
| 2026-11-11 | An Asset app started again on the ground during a run drops its queued Tasks. Operators see them marked not done and send again whatever still matters. Nothing resumes on its own. | An app restart during a run, on the ground. | [Runs and identity](runs-and-identity.md#keys-and-registration) |
| 2026-11-11 | One gateway is deployed per area, for the whole radio network. The network is a mesh: Assets talk to each other and to that one gateway, and many Assets ride on it. No Asset uses two gateways; several gateways in one network are out of scope. | Radio Assets and gateways. | [Runs and identity](runs-and-identity.md#radio-assets) |
| 2026-11-11 | A gateway replaced mid-run registers the radios it hears as new Assets with new IDs. The old Assets stay offline, and their unfinished Tasks are not carried over. | Within a run. | [Runs and identity](runs-and-identity.md#when-the-gateway-changes) |
| 2026-11-11 | "Registration" means an Asset joining a run: the event is `asset.registered` and the record is `registration`. "Provisioning" means only admin setup work, such as handing out keys and adding gateways and Plugins. | Docs and records. | [Protocol records](https://github.com/atlas-field-systems/atlas/blob/main/protocol/README.md#records) |
| 2026-11-11 | Every run starts the picture fresh. Across runs, every Asset registers again and comes back as a new Asset with a new ID that Core assigns; the acknowledgement tells it the ID. Nothing picks its own `asset_id`. `observation_id` stays Asset-chosen. Assets on IP work the same way: the admin hands out only the access key. | Across runs. Within a run, IDs stay. | [Runs and identity](runs-and-identity.md#ids) |
| 2026-11-11 | Each access key registers at most one Asset at a time. Reconnecting with the same key in the same run returns the same `asset_id`, unless an admin removed that Asset. | Within one run. | [Runs and identity](runs-and-identity.md#keys-and-registration) |
| 2026-11-11 | An Asset app started again during a run rejoins as itself through its key, with the same `asset_id`, unless an admin removed it. Its work does not resume (see the restart entries). This holds even if it forgot its ID, because the key proves which Asset it is. IDs stay Core-assigned and new each run; Assets do not pick fixed IDs. | Assets on IP, within one run. | [Runs and identity](runs-and-identity.md#keys-and-registration) |
| 2026-11-11 | No advance radio setup. A radio registers when the gateway first hears it in a run. A removed radio can register again as a new Asset. | Radio Assets, within a run. | [Runs and identity](runs-and-identity.md#radio-assets) |
| 2026-11-11 | A radio Asset whose app is started again during a run rejoins as itself by identifying itself to its gateway. It keeps its `asset_id`, unless an admin removed it. Its work does not resume (see the restart entries). | Radio Assets, within one run. | [Runs and identity](runs-and-identity.md#radio-assets) |
| 2026-11-11 | Radio identity is dropped from Core. The gateway is an IP bridge; edge identity stays on the gateway side. One gateway per site. | Core and the records. A Fieldlink still gives each radio its own identity. | [Gateway](https://github.com/atlas-field-systems/atlas/blob/main/gateway/README.md#what-every-fieldlink-provides) |
| 2026-11-11 | Carried between runs: accounts, connection keys, and installed Plugin setup. Not carried: Asset IDs, the run's picture, and operator state. | Across runs. | [Runs and identity](runs-and-identity.md#what-carries-over) |
| 2026-11-11 | Stopping Core on purpose is Reset; there is no separate Reset button. After Core stops, everyone signs in again. Leftover operator state (shared links, hidden tracks, sessions) is discarded, and links belong to one run. | Across runs. | [Runs and identity](runs-and-identity.md#a-run-and-reset) |
| 2026-11-11 | No retention. Once the Reset ZIP checks out, the run's data is deleted from Core; the ZIP is the only copy and is never deleted automatically. If the ZIP fails, see the 2026-11-12 entry. | Across runs. Within a run, nothing in the picture expires. | [Core Reset](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/reset.md#check-then-clear) |

## Places and Tasks

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-12 | Core decides the 64-Task cap from the Asset's latest queue report of how many Tasks it holds. It does not count Tasks still crossing the link or keep capacity until final reports arrive. `now` Tasks are still admitted at the cap. | Per Asset, ordinary work. | [Core API, operator requests](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#operator-requests) |
| 2026-11-12 | No clear count. A failed Task clears the Asset's queue; Tasks that arrive later run normally, and operators cancel what they don't want. | Failed Tasks and the queue. | [Core API, operator requests](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#operator-requests) |
| 2026-11-12 | When an Asset goes offline, its unanswered requests and Tasks show as not done and operators send again whatever still matters. Core does not reconcile them when the Asset returns. | Requests to an Asset that goes offline. | [Core API, operator requests](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#operator-requests) |
| 2026-11-11 | There are no multi-step Plans, only individual Tasks. | All work. | [Protocol working choices](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/decisions.md#tasks) |
| 2026-11-11 | Assets have no custom per-Asset settings yet. | Asset settings. | [Protocol working choices](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/decisions.md#settings) |
| 2026-11-11 | A Task keeps the place as it was when it was sent: a copy, not a live reference. | A named place in a Task. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-11 | When an operator edits a place that unfinished Tasks use, they are asked whether to update those Tasks. Core sends updated Tasks only if they say yes. Deleting a place does not change Tasks already sent. Edits and deletes still go through, and Core cancels nothing. | Places named by unfinished Tasks. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-11 | Core refuses a place that is not a point for `move_to` and `land`. | Those two commands. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-11 | Imagery is a fourth place kind, beside point, line, and area. It can only be renamed. The imagery must be deleted before the file it shows (`409` otherwise). Photo detection is removed. | Places and Objects. | [Core API, geo features](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#geo-features) |
| 2026-11-10 | The Task cap is 64 ordinary Tasks; a `now` Task is admitted even at 64. | Per Asset, ordinary work. | [Core API, operator requests](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#operator-requests) |
| 2026-11-10 | Hold is an ordinary command, like Land. It is not pause: it keeps no earlier Task to resume. | Commands. Pause stays a setting. | [Asset behavior, pause](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#pause) |

## Failsafes

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-12 | While the flight controller's own protection is in control, operators can only watch. The Asset shows that the flight controller took over and refuses operator commands until a person hands control back to Atlas. | Flying Assets. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#while-the-flight-controller-is-in-control) |
| 2026-11-12 | An override with Hold or pause re-arms every failsafe rule, not only lost-contact and low-battery rules, so a held Asset stays protected by everything the operator set up. | Failsafe state, after a Hold now or pause override. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#an-override-with-hold-or-pause-re-arms-protection) |
| 2026-11-12 | Failsafe rules are simpler: each firing runs its response once, with no configurable fallback (the critical Return-to-home fallback stays); priority does not only rise, so a rule can act again once no response is running; and there are no separate missing- or stale-data conditions. Area rules keep their distance margin and time outside. | Failsafe rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#a-failsafe-activates-a-configured-task) |
| 2026-11-12 | When several critical battery rules match, the highest-priority one wins. If a critical rule's response fails while the battery is still critical, the Asset falls back to Return to home, and that is the only fallback. Nothing is retried. | Critical battery rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#an-override-with-hold-or-pause-re-arms-protection) |
| 2026-11-11 | Operators can send a Fail-safe command to an Asset, as they send Land, Return to home, or Hold. The Asset treats it exactly as if its failsafe had fired: it runs the operator's failsafe rule for the command, and only if no rule applies falls back to the maker's built-in safe action. This is the answer to emergency commands for an offline Asset; Land, Return to home, and Hold get no offline exemption. | Commands. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#an-operator-can-fire-the-failsafe) |
| 2026-11-11 | When an operator overrides a fired failsafe with Hold or pause, protection is re-armed and can fire again once its condition recurs; which rules are re-armed is the 2026-11-12 entry. A fired failsafe still can't be cancelled. The overrides stay. | Failsafe state, after a Hold now or pause override. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#an-override-with-hold-or-pause-re-arms-protection) |
| 2026-11-11 | A critical battery rule is required on every flying Asset. Core refuses Tasks to a flying Asset that has none. | Flying Assets. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#no-rules-are-enabled-by-default) |
| 2026-11-11 | A lower critical battery level always fires, even after a Hold or pause override, so a held Asset can't hover until its battery dies. | Battery rules, in and out of failsafe state. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#an-override-with-hold-or-pause-re-arms-protection) |
| 2026-11-11 | Every flying Asset must have its flight controller run its own failsafe, such as returning home, when it loses contact with the computer running the Asset app, independent of Atlas. | Flying Assets. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#independent-flight-controller-protections) |
| 2026-11-11 | A failsafe response is always protective. There is no "keep going" or continue response: a condition whose response would be to keep going is not a failsafe. | Failsafe responses. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#no-rules-are-enabled-by-default) |
| 2026-11-11 | During a failsafe the operator may override with Land, Return to home, or Hold sent with `now`, or with pause. | Failsafe state. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation) |
| 2026-11-11 | A failsafe that has fired can't be cancelled or left; the Asset stays in failsafe state until it shuts down. | Failsafe state. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation) |
| 2026-11-11 | Failsafe boundaries are drawn separately from saved places; a failsafe response can't name a saved place. | Failsafe rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#configure-conditions-as-well-as-responses) |
| 2026-11-11 | Up to 16 failsafe rules and 16 pieces of equipment (subsystems) per Asset. | Per Asset. | [Protocol failsafe records](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/decisions.md#failsafes) |
| 2026-11-10 | Any operator may change failsafe rules. | Outside failsafe state. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#replace-the-policy-during-ordinary-operation) |
| 2026-11-10 | Low battery is a set percentage, not an estimate of the charge needed to get home. | Battery rules. | [Failsafes](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#configure-conditions-as-well-as-responses) |
| 2026-11-10 | A failsafe rule may react to degraded or faulted equipment. | Declared subsystems. | [Subsystem conditions](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/status.md#reports-describe-equipment) |

## The picture and Plugins

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-12 | Assets can upload files as Objects. An Asset's file is not pinned to where it was taken automatically: the Asset creates a geo feature alongside it, and the two are linked. | Assets and Objects. | [Core API, Objects](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#objects) |
| 2026-11-11 | Deleting an Object hides it from operators for the rest of the run. Core keeps it, marked deleted, in the end-of-run ZIP; it is not destroyed. | Objects. | [Core API, Objects](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#objects) |
| 2026-11-11 | Object files are capped at 100 MB by default. An admin may change the limit through the `max_object_bytes` setting. | Object files. | [Core API, Objects](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#objects) |
| 2026-11-11 | Lists returned are capped at 1000 items. | Pages of history and Plugin calls, and lists in a Plugin answer. | [Core API, Plugins answer](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#plugins-answer) |
| 2026-11-11 | Plugins choose how they appear: `help_text`, `in_menu`, and `show_on_map`, with menu and map off unless set. They should be really easy to configure and describe their own actions. | Plugin descriptions. | [Plugins](plugins.md#actions) |
| 2026-11-11 | A right-click action appears only when the action has exactly one input of the clicked kind. | The map's right-click menu. | [Plugins in the interface](https://github.com/atlas-field-systems/atlas/blob/main/command-interface/docs/plugins-and-objects.md#new-plugins-need-no-interface-change) |
| 2026-11-10 | A Plugin's rights over geo features are create-only. Plugin-suggested routes and repeating Plugin calls are out of scope. | Plugins. | [Plugins](plugins.md#not-plugins) |
| 2026-11-10 | Tracks come only from Fusion. Old Observations and Tracks stay in the picture for the whole run; Core adds no stale flag. | Within a run. | [Core API, Entities](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#entities) |

## Operations and setup

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-12 | Fixed-wing aircraft are not part of the current design. They come later as a new kind of Asset with its own commands. | Asset kinds. | [Assets and their equipment](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/assets.md#movement-module-and-profiles) |
| 2026-11-11 | One site per Core. | A Core, at a time. | [Scale](scale.md#setup) |
| 2026-11-11 | There is no remote shutdown or restart. | Assets. | [Asset behavior](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#shut-down-and-retain-evidence) |
| 2026-11-11 | A crashed Asset is inspected before its next flight. | An Asset after a crash. | [Using Atlas](using-atlas.md#an-operation-runs-without-planned-restarts) |
| 2026-11-11 | No part of Atlas assumes an Asset joins Wi-Fi during startup or setup. Some Assets may join known Wi-Fi networks; it is a possibility, not a requirement. | Every Asset. | [Asset communications](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/communications.md#several-links) |

## How work lands

| Date | Decision | Scope | Home |
| --- | --- | --- | --- |
| 2026-11-11 | Merges are local `git merge --no-ff` commits under the project's noreply identity, then a normal push; `gh pr merge` rejects that address. | This repository. | [AGENTS.md](https://github.com/atlas-field-systems/atlas/blob/main/AGENTS.md#working-rules) |
