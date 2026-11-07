# Asset docs

An Asset controls its equipment, carries out requested work, and reports what
actually happened. The SDK handles messages and queue delivery; the Asset app
owns execution and safe responses.

[Configuration](../config.md) inventories startup options for discussion.
[Logging](logging.md) defines the local diagnostic evidence to collect from the
app, equipment, and SDK throughout an operation.

## Start and connect

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

Immediate commands and cancel follow
[Protocol's rules](../../protocol/docs/communication.md#immediate-commands-and-cancel).
The app performs the requested motion or hold; the SDK does not fly the drone.
Settings follow the [shared settings contract](../../protocol/docs/communication.md#settings):
apply new immediate changes in receipt order and queued changes when their Task
runs. Report the resulting values rather than comparing operator and Asset clocks.

## Handle failures and link loss

The app monitors its equipment and the contact information exposed by the SDK.
It triggers the configured safe response when a failure occurs, including while
paused. A failed Task is a failure too. Low battery cannot be configured to
continue flying. The selected responses are described in
[First flight](../../atlas/first-flight.md#when-something-goes-wrong).

Link loss is timed locally under
[Protocol's contact rules](../../protocol/docs/communication.md#losing-the-link).
On reconnect the app keeps its execution state while the SDK restores message
delivery and queue reporting. Reconnecting alone never starts a Task again.

## Decisions still needed

- Which equipment failures trigger which configured response.
- How equipment confirms each command's completion, including position and
  altitude tolerances, and when an attempt has failed.
- Reset invocation, archive retrieval, and recording limits, tracked in
  [configuration](../config.md). [Logging](logging.md) defines the evidence to collect.

This is a behavior draft. It does not select flight-controller integrations or
simulation mechanics, and no Asset runtime is built here yet.
