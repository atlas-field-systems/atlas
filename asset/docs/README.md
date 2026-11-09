# Asset behavior

The Asset app keeps its own state, reports what it observes, and carries out
supported work through configurable [modules and equipment drivers](assets.md).
This is the selected plan. No runtime exists yet.

Protocol owns the records named here: the description, Task, queue, settings
change, and cancel, and the task, queue, telemetry, battery, settings, and
failsafe reports. [Protocol](../../protocol/README.md) defines their fields.

## Start and connect

An admin provisions an Asset on IP in Core and copies its `asset_id` and key into
its [configuration](../config.md). There is no enrollment key. An Asset behind a
gateway holds no Core key. How it is set up and authenticates to its gateway is
[not designed yet](../../core/docs/api.md#not-defined-yet). Once its identity,
clock, and communications are ready, the Asset connects in the order the
[Core API](../../core/docs/api.md#asset-and-gateway-calls) sets: check the
definitions hash, send its description, report its known settings, its queue,
and any final Task reports Core has not acknowledged, then follow its requests
from the last event it handled. Through a Fieldlink, the gateway makes these
calls for it. A definitions mismatch stops the connection, and the Asset logs
the explanation.

Equipment readiness is separate from connection readiness. Waiting for GPS, a
flight controller, a camera, or a detector does not hide an otherwise reachable
Asset. Supported settings are separate from their known values: an Asset may
support home before it has a position to set it. A reporting-only Asset sends
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
restart is rare and means shutting down the system for evaluation; there is no
mission recovery after one. A dropped link does not restart the app or clear
its state.

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

### The queue

The Asset holds its own queue. A queue reaches it whole, with its version and
every Task body, and the Asset applies it under the
[Core API's queue rule](../../core/docs/api.md#asset-and-gateway-calls). For
[first flight](../../atlas/first-flight.md), the ground Pi therefore holds the
complete Takeoff, Move To, Land list before starting it.

The Asset never runs a `task_id` twice. A Task that has started or ended never
starts again, whether it reappears in an old list, a repeated event, or after a
reconnect. Another attempt needs a new Task.

### Tasks that run now

Every command is a Task, including immediate ones. A Task sent with `now`
replaces the queue and runs at once, even while the Asset is paused. The Asset
reports the Task it interrupted and every Task it dropped as `cancelled`, and
the new Task reports its outcome like any other.

### Cancel

Cancel names one Task. A queued Task leaves the queue; an active Task stops its
work. In either case, the Asset reports the Task `cancelled`. The other Tasks
stay in the queue.
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
queue, though a Task sent with `now` still runs. Configured failsafes override
pause.

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
Asset is offline, so nothing waits to be delivered.

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
and the Asset's own Reset ZIP. There is no remote shutdown command.

## Open

- What a platform does when its active Task is cancelled, and whether the next
  Task then starts.
- Task reporting and continuation after a paused Asset is set running again.
- Equipment-specific completion evidence, tolerances, and timeouts.
- Recording limits, catch-up pacing, and how a reader knows history is complete.
- Shutdown and archive retrieval.
- Records this page names that Protocol does not define yet
  ([open questions](../../protocol/docs/open-questions.md)).
