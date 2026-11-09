# Command interface docs

This page records selected behavior. No interface code exists yet. The interface
reaches Core only through the [Core API](../../core/docs/api.md), using the
[SDK](../../sdk/README.md)'s browser client. Records named here, such as Task,
queue, settings change, cancel, description, and the Asset's reports, are
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

Each tab loads a snapshot of the Assets it shows, with their Tasks, then follows
the [event stream](../../core/docs/api.md#the-event-log-and-live-stream) after the
snapshot's `as_of`. A refresh, a new tab, or a dropped stream recovers the same
way, and the stream resumes after the last event the tab handled. Nothing is
missed or applied twice.

## Map and detail pages

The main page is `/map`, with a linked map, a searchable list, and a detail
panel. Selecting an item in the list or on the map shows it in the panel and
keeps its map context visible.

Each Asset also has its own addressable detail page. Operators can share or
bookmark it, refresh it, or open it in another tab. Track and Observation pages,
Geofeatures, and Objects are parked until after first flight.

An unfinished request draft stays in memory while the operator visits other
pages. For example, opening another Asset's page to check its position does not
discard the inputs already entered. Drafts do not survive a reload.

## RidgeLine and Atlas responsibilities

Use [RidgeLine](https://github.com/the-Drunken-coder/Ridgeline) for mapping and
reusable map tools. Atlas supplies its domain data, presentation, pages, command
forms, and operator workflows on top. RidgeLine remains a general-purpose package.

Document proposed RidgeLine changes here whenever Atlas needs them or they would
simplify either project or provide another benefit. Explain the need, the
package change, and the benefit compared with handling it in Atlas. The owner
approves changes before work starts in the RidgeLine repository.

## Prepare requests with the map

Offer the commands and settings the Asset lists in its description, with
explanations beside the controls. Support is separate from whether a current
setting value is known. A reporting-only tracker needs no movement controls,
pause control, or artificial home.

An operator fills a position input by picking a point on the map with "Pick on
map". While picking, the interface shows which field is being filled. Escape
cancels picking without discarding the rest of the draft.

Before sending, show the target Asset, input values, units, and the effect on
the queue. A new Task joins the end of the queue. **Run now** sends it with `now`:
it replaces the queue and runs at once, even while the Asset is paused, so the
confirmation lists the Tasks it will cancel. The operator submits explicitly,
and simple actions stay short.

- **Reorder or drop** Tasks that have not started by sending a new queue built
  on the latest reported version. If Core refuses a stale version, show the
  latest queue and let the operator redo the change.
- **Cancel** names one Task; the rest of the queue stays.
- **Pause and Resume** are a setting, sent as an end state.
- **Settings changes** are end states, applied at once or queued as a settings
  change Task.

A request whose response is lost is retried with the same idempotency key, so it
[never takes effect twice](../../core/docs/api.md#basics). Commands to an
offline Asset are refused, and the interface shows Core's explanation.

Polygon and Geofeature inputs, and RidgeLine's drawing tools for authoring them,
wait for Geofeatures after first flight. Drawing an area will never task an
Asset or create an enforced geofence by itself.

## Read Tasks, conditions, and history

Task bodies, latest states, and queue order come from
[the Asset's Tasks](../../core/docs/api.md#reads). For example, an active Move To
Task shows its destination. Show active, queued, and finished Tasks. Distinguish
the operator's request, Core's acceptance, and the Asset's reported outcome,
with source and age. A cancel stays pending until the Asset reports the Task's
state.

Show the Core connection, the Asset's contact as Core sees it, and its latest
telemetry, battery, settings, and failsafe reports separately, each with its
age. Receipt time proves neither fresh measurements nor two-way contact, and
connection does not mean equipment is ready; do not invent an overall verdict.
When an Asset is in [failsafe state](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation),
say so and offer only the overrides it accepts: Land now, Return to home now,
and pause. [Subsystem conditions](../../asset/docs/status.md) join these views
once their report exists.

History is [paged](../../core/docs/api.md#reads) and fetched on demand. Movement
history supports selectable time windows, playback, and scrubbing, starting with
one selected Asset's trail and a few controls. Its latest position stays
distinct from historical positions. Playback uses recorded sample times and
shows gaps rather than inventing samples. Historical inspection is clearly
labelled and has a way back to live. Playback never resends recorded commands.
Keep it small: no separate history framework, and no synchronized
reconstruction of every item on the map.

### Review a model-rocket flight

The operator requests launch through Atlas. The rocket is an Asset that starts
ignition through a launch pad or its own equipment.

The operator follows the flight until the rocket lands, then opens the recorded
launch data and scrubs or plays it, with the map and flight measurements
following the same playback time. Review includes every recorded sample,
including those that did not arrive over the live link: the rocket
[records more than it sends live](../../asset/docs/README.md#record-and-send-report-history)
and catches up after landing in report batches with their original times.
Missing data stays distinct from a recorded absence of activity.

### Diagnostics and simulation

Expandable diagnostic views show source records, Task bodies, and Core's error
codes and explanations. Normal views explain the evidence without requiring the
operator to read JSON.

Simulation runs in a separate test context that always shows its label and
destination. It supports cases such as stale reports, missing capabilities,
refused requests, and unknown outcomes. Sample data never stands in for an
outage, and a simulation warning never disappears.

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
- After first flight: geometry and Geofeature Task inputs, Track and Observation
  pages, and Object inspection and upload.

Natural-language interaction is out of scope. If revisited, it belongs on a
separate page.
