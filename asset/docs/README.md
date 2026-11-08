# Asset docs

An Asset reports what it observes and, where supported, controls equipment and
carries out requested work. A position beacon is an Asset even though it accepts
no equipment-control commands. The SDK handles messages and queue delivery;
the Asset app owns execution and safe responses.

[Assets and their equipment](assets.md) records the intended kinds of Asset,
the proposed companion-computer layout, and questions about the shared model.
[Configuration](../config.md) inventories startup options for discussion.
[Logging](logging.md) defines the local diagnostic evidence to collect from the
app, equipment, and SDK throughout an operation.

## Start and connect

The startup and flight behavior below describes the first-flight drone.

The Asset sets home to its startup position and has its clock set before it
connects. It supplies its identity, supported equipment capabilities, and current
settings to the SDK. The SDK performs the
[connection sequence](../../protocol/docs/communication.md#opening-a-connection-asset).

The Asset process and its SDK instance stay running for the whole operation.
The [operating assumption](../../atlas/using-atlas.md#the-four-pillars) excludes
process restart recovery. A dropped field link does not restart the app or clear
its local state.

## Carry out work and report its result

For [first flight](../../atlas/first-flight.md), the drone holds the complete
Takeoff, Move To, Land list before it starts. The
[SDK queue helper](../../sdk/docs/task-queue.md) holds and orders the Tasks; the
Asset app performs the physical actions. Receiving a Task is not completing it.

The app reports when work starts and when it completes, fails, or is cancelled.
Completion follows the observed equipment result. A failure includes its reason.
The SDK delivers final reports to Core, retrying through link loss until Core
acknowledges them.

[Command failure](failsafes.md#a-failed-command-cancels-the-remaining-tasks)
always cancels the remaining Tasks, independently of the configured safe response.

### Prepare and take off

When a Takeoff Task runs, the Asset app performs the preparation that its platform
requires and can control. This includes establishing flight-controller control,
selecting the required mode and takeoff settings, and arming before takeoff.
The operator does not need a separate software arming action.

Some platforms require a physical switch or button before the flight controller
can arm. The app respects that requirement; a Task does not replace the physical
action. If that requirement is unmet when Takeoff runs, the app fails the Task
with an explanation. It does not wait for someone to enable the switch or button.
Enabling it later does not revive the failed Task; another takeoff attempt needs
a new Task.

Preparation is part of executing the Task. Arming alone does not complete
Takeoff; completion follows the observed takeoff result. Each platform supplies
its own execution sequence, as proposed in
[the platform integration](assets.md#proposed-platform-integration).

### Other commands and settings

Immediate commands and cancel follow
[Protocol's rules](../../protocol/docs/communication.md#immediate-commands-and-cancel).
The app performs the requested motion or hold; the SDK does not fly the drone.
Settings follow the [shared settings contract](../../protocol/docs/communication.md#settings):
apply new immediate changes in receipt order and queued changes when their Task
runs. Report the resulting values rather than comparing operator and Asset clocks.

## Handle failures and link loss

The app monitors equipment, active work, its queue, and contact information from
the SDK. [Command failures and failsafes](failsafes.md) defines unconditional
command-failure cancellation and configurable safe-response conditions, including
being out of contact while airborne with no work left.

Link loss is timed locally under
[Protocol's contact rules](../../protocol/docs/communication.md#losing-the-link).
On reconnect the app keeps its execution state while the SDK restores message
delivery and queue reporting. Reconnecting alone never starts a Task again.

## Decisions still needed

- The remaining trigger, timeout, and priority decisions in
  [failsafes](failsafes.md#later-specification-work).
- How equipment confirms each command's completion, including position and
  altitude tolerances, and when an attempt has failed.
- Reset invocation, archive retrieval, and recording limits, tracked in
  [configuration](../config.md). [Logging](logging.md) defines the evidence to collect.

This is a behavior draft. It does not select flight-controller integrations or
simulation mechanics, and no Asset runtime is built here yet.
