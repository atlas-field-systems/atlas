# Asset behavior

The Asset app keeps its own state, reports what it observes, and carries out
supported work through configurable [modules and equipment drivers](assets.md).
This is the selected plan. No runtime exists yet.

Protocol owns the records named here: the description, Task, settings change,
and cancel, and the subsystem, task, queue, telemetry, battery, settings, and
failsafe reports. [Protocol](../../protocol/README.md) defines their fields.

## Start and connect

An Asset on IP gets its key from an admin, in its
[configuration](../config.md). Each run it joins as a new Asset and learns its
`asset_id` from Core: an Asset on IP registers itself with its key, and a
gateway registers a radio Asset for it.
[Runs and identity](../../atlas/runs-and-identity.md) owns registration and
IDs. Once its identity,
clock, and communications are ready, the Asset connects in the order the
[Core API](../../core/docs/api.md#asset-and-gateway-calls) sets: check the
definitions hash, send its description, report its known settings, its queue,
its active Task, and any final Task reports Core has not acknowledged, then follow its requests
from the last event it handled. Through a Fieldlink, the gateway makes these
calls for it. A definitions mismatch stops the connection, and the Asset logs
the explanation.

Equipment readiness is separate from connection readiness. Waiting for GPS, a
flight controller, a camera, or a detector does not hide an otherwise reachable
Asset. Supported settings are separate from their known values: the
description lists the settings an Asset supports, and an Asset may support home
before it has a position to set it. A reporting-only Asset sends
no artificial home, queue, or settings report.

The example configurations start acquisition and reporting at once. A tracker
obtains position, an ADS-B receiver listens, and a turret observes from its
current orientation. The quadcopter waits for work before arming or taking off.

### Position and home

Position comes from equipment, or from configuration for a stationary Asset.
Unknown position stays unknown. A GPS tracker without a valid fix sends no new
position, so Core keeps its last known position. A configured stationary
position stays valid while it describes the installation.

An Asset exposes home where its behavior uses it. The quadcopter sets home from
its first valid position. An explicitly configured or operator-set home takes
precedence. A reconnect does not reset home; operators change it as a setting.

The app and its link stay running for the operation, as Core does. An Asset
whose app stops shows offline, and the other Assets keep working. Nothing
restarts the app on its own; an app that fails in flight
[stays down](failsafes.md#if-the-app-fails-in-flight) while the flight
controller returns the vehicle home. An app started again on the ground in the
same run registers with its key and
[rejoins as the same Asset](../../atlas/runs-and-identity.md#keys-and-registration),
but its work does not resume: it drops its queued Tasks, and operators send
again what still matters.
An Asset keeps nothing from an earlier run. A dropped link does not restart the
app or clear its state.

## Carry out work and report its result

Core [checks requests](../../core/docs/requests.md) before passing them on. The
Asset makes decisions that need current equipment knowledge, because
equipment can change after Core accepts a request. Receiving a Task is not
completing it.

The Asset reports each Task `active` when it starts, then one final state:
`completed`, `failed`, or `cancelled`. Completion follows the observed equipment
result. If required equipment or position is unavailable when a Task starts, the
Task fails with an explanation rather than waiting. Becoming ready later does
not revive failed work. A failed Task
[cancels the remaining Tasks](failsafes.md#a-failed-command-cancels-the-remaining-tasks).

A Task that names a place carries a copy of it, made when the Task was sent,
and the Asset works from that copy. A later edit or deletion of the place does
not reach the Asset. If the operator who edits the place chooses to update the
Tasks that use it, Core sends those Tasks again with the new copy
([Core API](../../core/docs/api.md#geo-features)). The Asset uses the new copy
for a Task it has not started; an active Task carries on to the updated place;
an update to a Task that has ended changes nothing. An updated place is not a
failure by itself, so it never cancels the remaining Tasks.

### The queue

The Asset holds its own queue: the Tasks it has received and not started. Core
[numbers each Task](../../core/docs/api.md#operator-requests) with its `task_id`,
and the Asset runs its Tasks in that order, whatever order they arrive in.

The Asset starts a Task only when both of these hold:

- Every Task with a lower `task_id` has ended. A Task that is still crossing the
  link blocks the Tasks after it.
- The Asset has received every Task that was sent in the same request, so a
  mission never starts in part. A cancelled Task counts as received.

For [first flight](../../atlas/first-flight.md), the ground Pi therefore holds
the complete Takeoff, Move To, Land list before starting it.

The Asset never runs a `task_id` twice. A Task that has started or ended never
starts again, whether it reappears in a repeated event or after a reconnect.
Another attempt needs a new Task.

An Asset with no Task to run waits in place for work, with its platform hold. A
copter that finishes its last Task in the air loiters there until an operator
sends more. An empty queue is ordinary, and no
Task has to follow another. Only a
[configured failsafe rule](failsafes.md#configure-conditions-as-well-as-responses)
responds to an empty queue.

### Tasks that run now

Every command is a Task, including immediate ones. Hold now, for example, stops
the Asset where it is and drops the work before it. A Task sent with `now` runs
at once, even while the Asset is paused, and cancels every Task with a lower
`task_id`, including Tasks that have not arrived yet. The Asset reports the Task
it interrupted and every Task it cancelled as `cancelled`, and the new Task
reports its outcome like any other.

### Cancel

Cancel names one Task. A queued Task leaves the queue; an active Task stops its
work. In either case, the Asset reports the Task `cancelled`. The other Tasks
stay in the queue, and after an active Task is cancelled the Asset starts the
next one.
A cancel for a Task that has not arrived yet still counts. The Asset reports the
Task `cancelled` and never runs it.
Cancelling a Task that has already ended changes nothing.

### Prepare and take off

When a copter Takeoff Task runs, its movement profile performs the preparation
the platform requires and can control: establishing flight-controller control,
selecting the mode and takeoff settings, and arming. The operator needs no
separate arming action.

Some platforms require a physical switch or button before arming. If that
requirement is unmet when Takeoff runs, the Task fails with an explanation. The
app does not wait. Arming alone does not complete Takeoff; completion follows the observed
takeoff.

### Pause

Pause is a setting, not a Task. It suspends current movement with a
platform-specific hold: copters stop and loiter in place, fixed-wing aircraft
loiter, and ground vehicles brake and stop. A paused Asset does not advance its
queue, though a Task sent with `now` still runs.

Pause keeps the active Task; it does not end it. The Task stays `active` and
continues when the Asset is set running again. The settings report showing
`run_state` paused is the evidence of the pause. A Task that cannot continue after
the pause fails with an explanation, like any failed Task. Pause never cancels
work the way `now` does. Configured failsafes override
pause. Paused work still counts toward Core's
[64-Task cap](../../core/docs/api.md#operator-requests), which Core reads from
the queue report. The Asset reports its
complete held, unstarted queue, without truncation or windows.

Pause is not Hold. Hold is a command, like Land: it stops the Asset, completes,
and keeps no earlier Task to resume. Pause keeps the active Task and resumes it.

### Settings

A settings change names end states, so repeating one changes nothing. The Asset
applies immediate changes in event order, alongside its own local changes, and a
settings change Task when that Task runs. It reports the resulting values in a
settings report rather than comparing operator and Asset clocks.

## Handle failures and link loss

The app watches its equipment, its work, and its contact with Core. Contact
comes from the [Core API's contact rule](../../core/docs/api.md#contact) on IP, or
from the Fieldlink on radio. [Command failures and failsafes](failsafes.md) owns
cancellation, configured conditions, response Tasks, and operator overrides.
These decisions stay local so they work without Core.

On reconnect, the app keeps its execution state and repeats the connect
sequence. Reconnecting never restarts a Task. Core refuses commands while the
Asset is offline and
[drops the requests the Asset had not answered](../../core/docs/api.md#operator-requests),
so no old request arrives late.

## Record and send report history

An Asset can record more reports than its live link can carry. For the
[model-rocket flight](../../command-interface/docs/README.md#review-a-model-rocket-flight),
it keeps the extra samples locally and sends a live subset. After landing, with
contact restored or a faster link available, it sends the retained reports in
[report batches with their original times](../../core/docs/api.md#asset-and-gateway-calls).
An Asset returning after a disconnection catches up the same way.

These reports fill shared history. They are separate from local diagnostic logs
and Reset ZIPs.

## Shut down and retain evidence

The app records equipment, module, and link evidence locally for the whole
operation, including while disconnected. [Logging](logging.md) owns that record
and the Asset's own Reset ZIP, written when the app shuts down. There is no
remote shutdown command. The operator shuts the Assets down before the admin
stops Core, which ends Core's run ([Reset](../../core/docs/reset.md)). An Asset
left running into Core's next run is not supported.

## Open

- Equipment-specific completion evidence, tolerances, and timeouts.
- Recording limits, catch-up pacing, and how a reader knows history is complete.
- Records this page names that Protocol does not define yet
  ([open questions](../../protocol/docs/open-questions.md)).
