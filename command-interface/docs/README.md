# Command interface docs

This page records selected behavior. No interface code exists yet. The interface
reaches Core only through the [Core API](../../core/docs/api.md), using the
[SDK](../../sdk/README.md)'s browser client. Records named here, such as Task,
settings change, cancel, description, and the Asset's reports, are
[Protocol's](../../protocol/README.md). How operators use Plugins and Objects is
in [Plugins and Objects](plugins-and-objects.md).

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
  places a Plugin made. A place is a point, line, area, or imagery, with an
  optional name; imagery can only be renamed
  ([Area and place inputs](#area-and-place-inputs)).

### Hide items in your own view

Hiding a Track and hiding old Tracks and sightings are view filters. A view
filter belongs to one browser and one [run](#links-and-choices-belong-to-one-run):
it survives a refresh and carries into new tabs, but it does not follow the
operator to another computer, and other operators never see it. The map and list always show how many items are hidden, with a
**Show all** button, so a hidden item is never silently lost.

### Every item has its own page

Every Asset, Track, sighting, place, Object, and [Plugin call](plugins-and-objects.md#run-a-plugin)
has its own address. Operators can share or bookmark it, refresh it, or open it
in another tab. The address opens `/map` with that item selected, its details in
the panel, and the map around it.

| Page | Shows |
| --- | --- |
| Asset | Its Tasks, conditions, and history, as [below](#read-tasks-conditions-and-history). |
| Track | What Fusion concluded, its position or direction, its age, the sightings it rests on with the Asset and age of each, and its past path. A **Hide** button adds it to the view filter. Nothing on the page changes the Track. |
| Sighting | The Asset that reported it, what it reports, its age, the Track that uses it, and its earlier reports from history. |
| Place | Its shape and name, who made it, and the Plugin call that made it if a Plugin did. The unfinished Tasks that name it, its attached Objects, edit and delete, and the Plugin actions that take a place. |
| Imagery | Its name, the GeoTIFF it shows with a link to that Object's page, who added it, rename, and delete. |
| Object | See [Objects](plugins-and-objects.md#objects). |
| Plugin call | See [Run a Plugin](plugins-and-objects.md#run-a-plugin). |

A page for something that is gone during the run says what happened. It shows
when the item went and who removed it, shows the item as it last stood, and
offers to open it in history. A Track Fusion removed and a deleted place come
from [Track and geo feature history](../../core/docs/api.md#reads). A page never
just says "not found".

### Links and choices belong to one run

Each run starts with an empty picture and new IDs, so an ID from one run may
name something else in the next
([Runs and identity](../../atlas/runs-and-identity.md)). Every page address
names its run, and every view filter is kept for one run.

- **Stopping Core ends every session.** Everyone signs in again in the new run.
- **A new run discards the old run's state.** When the tab finds that Core's run
  has changed, it drops everything it held from the earlier run: the picture,
  drafts, view filters, result overlays, and open pages. Nothing from that run
  lingers in the interface.
- **An old link never opens a new item.** A link from an earlier run opens a
  page that says its run has ended and that the run's record is in that run's
  Reset ZIP, not in Core. It never opens an item of the new run that has the
  same ID, and it offers no history, because Core no longer holds that run.

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

[Drawing places](#draw-places) uses RidgeLine's drawing tools, limited to
lines and areas without holes, rectangles, and circles. Atlas turns a rectangle
or circle into area corners when it saves. These changes are proposed, none
approved yet:

| Need | Proposed RidgeLine change | Benefit over doing it in Atlas |
| --- | --- | --- |
| Drawing a point place | A point tool in the drawing rail | Points draw like every other shape. Without it, Atlas adds points through its right-click menu. |
| Areas of at most 32 corners | An optional corner limit for areas and circles | The limit shows while drawing, instead of a refusal when the operator presses Finish. |
| Imagery places | A layer that draws a georeferenced image from its corners | Any RidgeLine user can lay an image on the map. Atlas reads the GeoTIFF and passes its image and corners. |

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
- **Fail-safe** fires the Asset's failsafe, as if a rule had fired: the Asset
  runs its rule for the command, or its built-in safe action if none applies.
  It is offered when the Asset lists the `failsafe` command, is sent with `now`, and
  asks for confirmation, because the Asset stays in failsafe state for the rest
  of the operation ([Failsafes](../../asset/docs/failsafes.md#an-operator-can-fire-the-failsafe)).
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

### Area and place inputs

None of today's commands takes an area or a place. When one does, such as a
search of an area, the operator fills it in either of two ways:

- **Draw it on the spot.** The drawn area belongs to that draft only, and the
  Task carries it. It becomes a shared place only if the operator presses
  **Save as place**, and the Task then names that place instead.
- **Pick a place.** The Task names the place and carries a copy of it as it
  was when the Task was sent ([Core API](../../core/docs/api.md#geo-features)).
  The draft and the Task show the place's name and link to its page.

A point place can also fill a position input, such as Move To a named helipad.
The Task names the point place in the same way.

Any operator may edit or delete a place that unfinished Tasks name. The change
always goes through. When the operator saves an edit, the interface lists those
Tasks and asks whether to update them to the new shape. Only if the operator
says yes does Core send the updated Tasks; otherwise they keep the place as it
was when sent. The interface then shows which Tasks Core updated and which it
could not, such as those of an offline Asset. Deleting a place asks nothing and
changes no Task already sent. A changed or deleted place cancels nothing by
itself.

A failsafe rule's boundary is never a place. The Asset stores its failsafe
policy itself, so the operator draws each boundary in the failsafe rule, apart
from the places on the map.

Drawing an area never sends anything, tasks an Asset, or creates an enforced
geofence by itself.

## Draw places

The drawing tools add a point, a line, or an area. A rectangle and a circle are
shortcuts that save as an ordinary area outline, so a circle becomes a
many-sided shape. An area has no holes. A finished drawing asks for an optional
name and is saved as a place at once, shared with everyone. An area holds 3
to 32 corners, as [Protocol's area](../../protocol/definitions/components/area.json)
does, and the tools say so while drawing.

**Add imagery** takes a GeoTIFF file. The interface stores it as an Object,
then adds an imagery place that shows it on the map where the file says it
belongs. Only a GeoTIFF can become imagery; other files stay ordinary Objects.
Imagery can be renamed or deleted, never moved or reshaped. To correct one, the
operator adds a new imagery place from a corrected file. Deleting imagery leaves
its file. Plugins add imagery the same way.

Any operator or admin edits or deletes any place, including one a Plugin made.
Deleting asks for confirmation, and when Objects are attached it says they
will stay as unattached Objects.

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
When Core [refused an Asset, gateway, or radio](../../core/docs/api.md#basics) for
different Protocol definitions, show that refusal, so a missing Asset has a
visible reason.
Show which gateway carries each radio Asset, and the gateway's own contact, so
the operator can tell a gateway that is down from radios that went quiet.
When an Asset is in [failsafe state](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation),
say so and offer only the
[overrides it accepts](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation):
Land now, Return to home now, Hold now, and pause. Name the rule that fired
and why, its response and its outcome, and whether a fallback ran. If the flight controller's own protection took over,
say so rather than naming an Atlas rule. Show the Asset's failsafe rules where
an operator can read and replace them outside a failsafe.

Show each declared [subsystem](../../asset/docs/status.md) with its last reported
condition, explanation, and age. A subsystem that has not reported is shown as
unreported, not healthy. Do not combine them into an overall condition.

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

- Exact page addresses, history controls, package integration, and basemap provider.
- Whether admin work, such as accounts and Asset, gateway, and Plugin keys, lives
  in this interface.
- The model rocket's launch command, equipment layout, recording limits, and how
  review knows the record is complete.
- Reordering drafts, and keeping drafts across a reload.

Natural-language interaction is out of scope. If revisited, it belongs on a
separate page.
