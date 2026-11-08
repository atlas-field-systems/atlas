# Asset docs

The Asset app maintains its own state, reports information, and carries out
supported work through configurable modules and equipment drivers. The
[Asset model](assets.md) describes initial Assets and the selected structure.
[Configuration](../config.md) separates selected requirements from proposed
options. [Subsystem conditions](status.md) describes hardware-status reporting.

This is selected planning direction. No Asset runtime is built yet, and several
[shared contracts](../../protocol/docs/open-questions.md#unresolved) still need
exact definitions. These pages do not claim that current schemas express them.

## Start and connect

The communications module supplies the Asset's identity and explicit supported
command list to the SDK. Once identity, clock, and communications are ready, the
Asset can connect using the [SDK connection sequence](../../sdk/docs/links.md).
Equipment readiness is separate from connection readiness. Waiting for GPS,
a flight controller, a camera, or a detector does not hide an otherwise reachable
Asset.

Supported settings are separate from their currently known values. An Asset may
support home before it has a position to establish home. A reporting-only Asset
needs no artificial home, run state, task queue, or settings report when it
supports none of those functions. Protocol's current connection rules do not yet
express the complete [minimal startup path](../../protocol/docs/open-questions.md#unresolved).

The example configurations start acquisition and reporting automatically.
A tracker obtains position, an ADS-B receiver listens, and a turret observes from
its current orientation. The quadcopter waits for work before arming or taking
off. Startup behavior is configurable, as described in the [Asset model](assets.md#configuration-and-commitments).

### Position and home

Position can come from equipment or manual configuration for a stationary Asset.
Unknown position stays unknown. A GPS tracker without a valid fix sends no new
position update. A lost fix leaves Core with its last known position and the
reported GPS condition. A configured stationary position remains valid while it
describes the installation.

An Asset exposes home where its behavior uses it. The first quadcopter establishes
home once its first valid startup position is available. An explicitly configured
or operator-set home takes precedence over automatic initialization. Home is not
reset by a reconnect. Operators can change it through supported settings.

The app and its SDK instance stay running for the operation. The
[operating assumption](../../atlas/using-atlas.md#the-four-pillars) excludes process
restart recovery. A dropped field link does not restart the app or clear state.

## Carry out work and report its result

Core owns [request admission](../../core/docs/requests.md), using shared SDK
validation before forwarding work. The Asset retains decisions that require
current equipment knowledge. Equipment can change after Core accepts a request.

For [first flight](../../atlas/first-flight.md), the drone holds the complete
Takeoff, Move To, Land list before starting. The
[SDK queue helper](../../sdk/docs/task-queue.md) holds and orders Tasks. The app
coordinates execution through the appropriate module and equipment drivers.
Receiving a Task is not completing it.

If required equipment or position is unavailable when a Task starts, fail the
attempt with an explanation rather than waiting indefinitely for readiness.
Normal platform preparation remains part of execution. Becoming ready later
does not revive failed work. Another attempt needs new Tasks.

The app reports work starting and its completion, failure, or cancellation.
Completion follows the observed equipment result. The SDK delivers final
reports to Core, retrying through link loss until Core acknowledges them.
[Subsystem conditions](status.md#reports-describe-equipment) do not impose a
separate health gate on execution.

### Prepare and take off

When a copter Takeoff Task runs, its movement profile performs the preparation
that the platform requires and can control. This includes establishing
flight-controller control, selecting the required mode and takeoff settings,
and arming. The operator needs no separate software arming action.

Some platforms require a physical switch or button before arming. The app
respects that requirement. If it is unmet when Takeoff runs, the app fails the
Task with an explanation. It does not wait for someone to enable the switch or
button. Enabling it later does not revive the failed Task.

Arming alone does not complete Takeoff. Completion follows the observed takeoff
result. Equipment-specific evidence, tolerances, and timeouts remain open.

### Pause

Pause suspends the current movement. Each Asset handles the physical response:
copters stop and loiter at their current position, fixed-wing aircraft loiter,
and ground vehicles brake and stop. Paused Assets do not advance their Task queue.
Configured failsafes still override pause.

Task reporting and continuation after Resume remain
[open](../../protocol/docs/open-questions.md#unresolved).

### Other commands and settings

Immediate commands and cancel follow
[Protocol's rules](../../protocol/docs/communication.md#immediate-commands-and-cancel).
The app performs the motion or hold. The SDK never controls equipment.
Settings follow the [shared contract](../../protocol/docs/communication.md#settings).
Apply new immediate changes in receipt order and queued changes when their Task
runs. Report resulting values rather than comparing operator and Asset clocks.

## Handle failures and link loss

The app monitors equipment, work, its queue where supported, and SDK contact
information. [Command failures and failsafes](failsafes.md) owns cancellation,
configured conditions, response Tasks, and the operation-long work lock.
These decisions remain local so they can operate without Core contact.

Link loss is timed locally under
[Protocol's contact rules](../../protocol/docs/communication.md#losing-the-link).
On reconnect the app keeps its execution state while the SDK restores message
delivery and applicable queue reporting. Reconnecting alone never restarts a Task.

## Shut down and retain evidence

The app records equipment, module, and SDK evidence locally throughout the
operation, including while disconnected. [Logging](logging.md) owns that record
and the Asset's own Reset ZIP. Shutdown and archive retrieval mechanisms remain
open. No remote shutdown command or process restart recovery is selected here.
