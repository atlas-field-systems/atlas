# Request admission

This behavior is selected but not implemented.

Core rejects requests it knows are invalid before they reach a field link. It
validates request bodies with Protocol's validator, then checks the
caller's session or key, the Asset's contact, the commands and settings its
description lists, Task identities, and the 64-Task cap against the Asset's
latest queue report. The [operator request rules](api.md#operator-requests)
own the cap and the `now` exception.
Refusals follow the
[Core API's errors](api.md#basics).

Core retains requested work in its event log and passes accepted requests to the
Asset under the [Core API](api.md#operator-requests).

[Current equipment checks and execution](../../asset/docs/README.md#carry-out-work-and-report-its-result)
remain with the Asset. [Subsystem conditions](../../asset/docs/status.md) do not
automatically gate commands. Configured [failsafes](../../asset/docs/failsafes.md)
remain with the Asset runtime, including while disconnected from Core.
This follows
[decisions near their source](../../atlas/design-decisions.md#decisions-stay-near-their-source).

## Scenario: paused work at capacity

These are required outcomes for the future runtime, not implemented tests.

1. An online Asset is paused, and its latest queue report lists 63 held Tasks.
   An operator sends one Task. Core accepts it.
2. Once the Asset's queue report lists 64, another ordinary request is refused
   whole with `409 queue_full`. Core assigns no Task ID and sends nothing.
3. The operator cancels one Task. When the Asset's next queue report lists 63,
   a new request for one Task is accepted again.
4. Two requests for one Task each, sent before the Asset reports either, are
   both accepted. The Asset holds 64 after the first, so it reports the second
   Task `cancelled`, with a full queue as its explanation. No queue report
   lists more than 64.

## Scenario: now at capacity

1. The Asset's latest queue report lists 64 held Tasks. An ordinary request for
   one more is refused with `409 queue_full`.
2. The operator sends one Task with `now`, such as Land or Return to home. Core
   accepts it. It runs at once and cancels every lower `task_id`, so the next
   queue report lists none of them.
