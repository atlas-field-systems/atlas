# Request admission

This behavior is selected but not implemented.

Core rejects requests it knows are invalid before they reach a field link. It
validates request bodies with Protocol's validator, then checks the
caller's session or key, the Asset's contact, explicitly advertised commands,
supported settings, Task identities, and total outstanding Task capacity using
the information it holds. The [operator request rules](api.md#operator-requests)
own the 64-Task cap and atomic capacity reservation. Refusals follow the
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

1. An online Asset is paused with no outstanding Tasks. An operator sends 32
   Tasks. Core accepts them and reserves 32 places, even before delivery.
2. Before those Tasks arrive, another request sends 32 more. Core accepts it;
   all 64 places are now reserved across the two requests.
3. A third request sends one Task while delivery is still in flight. Core
   refuses the whole request with `409 queue_full`. It assigns no Task ID and
   sends no work to the Asset.
4. The paused Asset receives both accepted requests. Its complete queue reports
   truthfully name all held unstarted Tasks, reaching 64 IDs. No report is
   truncated, and the refused request adds no 65th ID.
5. Another request while all 64 remain held is refused too. Retrying an accepted
   request adds no work. Retrying a refused request repeats the refusal.
6. The operator cancels one Task. Sending the cancel alone frees no place.
   After Core stores the Asset's final `cancelled` report, a new request with a
   new idempotency key can add one Task, returning the total to 64.

Also check concurrent admission at 63 outstanding Tasks: two requests for one
Task each allow exactly one acceptance. A request for two is refused whole.
With one active Task and 63 accepted or held Tasks, new work is also refused.
Dropping an unanswered request does not free its places before final Asset
reports resolve its Tasks. An immediate `now` Task uses the same capacity check.
