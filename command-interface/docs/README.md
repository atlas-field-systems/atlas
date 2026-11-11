# Command interface docs

This page records selected behavior. No interface code exists yet. The interface
reaches Core only through the [Core API](../../core/docs/api.md), using the
[SDK](../../sdk/README.md)'s browser client. Records named here, such as Task,
settings change, cancel, description, and the Asset's reports, are
[Protocol's](../../protocol/README.md).

## Operators and connectivity

This interface serves operators at a command station with internet access and a
connection to Core. An interface for teams at the edge is a separate future
tool. Offline basemap operation is not a requirement.

Operators log in to their admin or operator
[account](../../core/docs/api.md#callers-and-credentials). The session is an
HttpOnly cookie, so every tab shares it, and logging out ends it in every tab.
When Core reports that its Protocol definitions differ from the interface's, the
interface shows Core's explanation and sends nothing.

External basemap tile services are allowed. Application code and assets ship
with the project under the repository's no-CDN rule. A basemap failure stays
distinct from loss of Core contact, and list and detail inspection keep working.

## Recover after a refresh or a new tab

Each tab loads the shared picture through `GET /entities`
([Entities](../../core/docs/api.md#entities)) and reads the Tasks for the Assets
it shows separately. It then follows the
[event stream](../../core/docs/api.md#the-event-log-and-live-stream) from the
smallest `as_of`, skipping events already included in each read, as the
[SDK live picture](../../sdk/docs/live.md#live-picture) describes. A refresh or a
new tab loads those snapshots again. After a dropped stream, the tab resumes
after the last event it handled. Nothing is missed or applied twice.

## Map and detail pages

The main page is `/map`, with a linked map, a searchable list, and a detail
panel. Selecting an item in the list or on the map shows it in the panel and
keeps its map context visible.

The map draws the [shared picture](../../core/docs/api.md#entities): Assets,
Tracks, and places (geo features).

- **Tracks are the main picture.** Selecting a Track shows the sightings
  (Observations) behind it. The operator can also switch on every sighting.
- **A target known only by direction** shows as a line from the sensor that saw
  it, drawn from its sightings.
- **Every Track and sighting shows its age.** Core never marks them stale, and
  they stay in the picture for the whole run. The operator can hide old ones as
  a view filter.
- **Operators cannot move, rename, or delete a Track.** Only Fusion changes
  Tracks. An operator who disagrees with one hides it in their own view.
- **Any operator or admin can create, change, or delete any place**, including
  places a Plugin made. A place is a point, line, or area with an optional
  name. Changing or deleting a place never changes a Task already sent.

Each Asset also has its own addressable detail page. Operators can share or
bookmark it, refresh it, or open it in another tab. Track, Observation,
Geofeature, and Object pages are not designed yet.

[Draft Tasks](#draft-tasks-on-the-map-then-send-them) stay in memory while the
operator visits other pages. For example, opening another Asset's page to check
its position does not discard them. Drafts do not survive a reload.

## RidgeLine and Atlas responsibilities

Use [RidgeLine](https://github.com/the-Drunken-coder/Ridgeline) for mapping and
reusable map tools. Atlas supplies its domain data, presentation, pages, command
forms, and operator workflows. RidgeLine remains a general-purpose package.

Document proposed RidgeLine changes here whenever Atlas needs them or they would
simplify either project or provide another benefit. Explain the need, the
package change, and the benefit compared with handling it in Atlas. The owner
approves changes before work starts in the RidgeLine repository.

## Draft Tasks on the map, then send them

Offer the commands and settings the Asset lists in its description, with
explanations beside the controls. Support is separate from whether a current
setting value is known. A reporting-only tracker needs no movement controls,
pause control, or artificial home.

Commanding works as in a small tactical RTS game. An operator directs a few
Assets one at a time, so there is no box selection and no order to a group.

With an Asset selected, a right-click on the map opens a menu of the commands the
Asset lists. Choosing a command adds a draft at that point. For example, a
right-click and then Move To adds a draft Move To there. A right-click never
sends anything by itself.

A draft is not a Task. It exists only in the interface, and Core and the Asset
never see it. Drafts follow the Asset's queue in the order the operator added
them. The map and the queue list draw a draft differently from a sent Task, and
show its target Asset, input values, and units. Nothing that happens on the Asset
sends, changes, or removes a draft.

The operator selects a draft to change its values or delete it. An operator
fills a position input by picking a point on the map with "Pick on map". While
picking, the interface shows which field is being filled. Escape cancels picking
without discarding the rest of the draft.

Each draft has two buttons:

- **Confirm** keeps the values and marks the draft confirmed. It sends nothing.
- **Confirm and Send** sends the draft and every draft before it
  [in one request](../../core/docs/api.md#operator-requests). The Asset starts
  none of them until it has received them all. Drafts after it stay drafts.

For example, the operator drafts Takeoff, Move To, and Land, then presses
**Confirm and Send** on Land. The Asset receives the whole flight before it
takes off. A single action is one draft and one press.

Sent Tasks join the end of the queue. **Run now** sends one draft with `now`: it
runs at once, even while the Asset is paused, and cancels every Task sent before
it, so the confirmation lists the Tasks it will cancel.

- **Cancel** names one Task; the rest of the queue stays.
- **Change the order** of sent Tasks by cancelling them and sending new ones.
  Core has no reorder request.
- **Pause and Resume** are a setting, sent as an end state.
  While paused, the active Task shows as held, not ended, and it continues on
  Resume. Pause is offered only when the Asset lists it as a supported setting.
- **Settings changes** are end states, applied at once or queued as a settings
  change Task.

If a request's response is lost, the interface retries it with the same
idempotency key, so it [never takes effect twice](../../core/docs/api.md#basics).
Commands to an offline Asset are refused, and the interface shows Core's
explanation. A request that Core
[dropped when the Asset went offline](../../core/docs/api.md#operator-requests)
shows as unconfirmed, because it may have reached the Asset. The Asset's later
reports show what it did. The operator sends it again only if those reports
show it did not run.

Polygon and Geofeature Task inputs, and RidgeLine's drawing tools for authoring
places, are not designed yet. Drawing an area will never task an
Asset or create an enforced geofence by itself.

## Read Tasks, conditions, and history

Task bodies, latest states, and the Tasks the Asset holds come from
[the Asset's Tasks](../../core/docs/api.md#reads). Show each sent Task's number
and whether the Asset reports holding it, so the operator sees each Task arrive.
For example, an active Move To Task shows its destination. Show active, queued, and finished Tasks. Distinguish
the operator's request, Core's acceptance, and the Asset's reported outcome,
with source and age. A cancel stays pending until the Asset reports the Task's
state.

Show the Core connection, the Asset's contact as Core sees it, and its latest
telemetry, battery, settings, and failsafe reports separately, each with its
age. Receipt time proves neither fresh measurements nor two-way contact, and
connection does not mean equipment is ready; do not invent an overall verdict.
When Core [refused an Asset or gateway](../../core/docs/api.md#basics) for
different Protocol definitions, show that refusal, so a missing Asset has a
visible reason.
When an Asset is in [failsafe state](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation),
say so and offer only the overrides it accepts: Land now, Return to home now,
and pause. [Subsystem conditions](../../asset/docs/status.md) join these views
once their report exists.

History is [paged](../../core/docs/api.md#reads) and fetched on demand. Movement
history supports selectable time windows, playback, and scrubbing, starting with
one selected Asset's or Track's trail and a few controls. A Track's past path
replays the same way as an Asset's trail. Its latest position stays
distinct from historical positions. Playback uses recorded sample times and
shows gaps rather than inventing samples. Places show as they stood at the
playback time, so a place deleted later still shows before its deletion, and a
deleted place leaves the live map. Historical inspection is clearly
labelled and has a way back to live. Playback never resends recorded commands.
Use no separate history framework. Playback rebuilds only the selected trails
and the places, not every item on the map.

### Review a model-rocket flight

The operator requests launch through Atlas. The rocket is an Asset that starts
ignition through a launch pad or its own equipment.

The operator follows the flight until the rocket lands, then opens the recorded
launch data and scrubs or plays it, with the map and flight measurements
following the same playback time. Review includes every recorded sample,
including those that did not arrive over the live link. The rocket
[records more than it sends live](../../asset/docs/README.md#record-and-send-report-history)
and catches up after landing in report batches with their original times.
Missing data stays distinct from a recorded absence of activity.

### Diagnostics and simulation

Expandable diagnostic views show source records, Task bodies, and Core's error
codes and explanations. Normal views explain the evidence without requiring the
operator to read JSON.

Simulation runs in a separate test context that always shows its label and
destination. It supports cases such as stale reports, missing capabilities,
refused requests, and unknown outcomes. The interface never substitutes sample
data during an outage, and a simulation warning never disappears.

## Responsibilities

The interface owns local drafts and view state. The SDK client makes the Core API
calls, checks bodies with Protocol's validator, and resumes the event stream.
Core [admits requests](../../core/docs/requests.md) and assigns each `task_id`.
The Asset owns [execution](../../asset/docs/README.md#carry-out-work-and-report-its-result).
Interface prototypes find what the SDK client needs, and those findings go to
the SDK docs.

## Open

- Exact detail routes, history controls, package integration, and basemap provider.
- Whether admin work, such as accounts and Asset and gateway provisioning, lives
  in this interface.
- The model rocket's launch command, equipment layout, recording limits, and how
  review knows the record is complete.
- Geometry and Geofeature Task inputs, Track and Observation pages, and Object
  inspection and upload.
- Reordering drafts, and keeping drafts across a reload.

Natural-language interaction is out of scope. If revisited, it belongs on a
separate page.
