# Request admission

**Built.** Core implements the admission rules below.

Core rejects requests it knows are invalid before they reach a field link. It
validates request bodies with Protocol's validator, then checks the caller's
session or key, the Asset's contact (including an open command stream for an
Asset on IP), the commands and settings its description lists, Task identities,
and the critical battery rule for flying Assets. There is no Task queue cap
([ADR-0023](../../docs/adr/0023-no-task-queue-limit.md)); Task IDs stay limited
to 9999 per Asset between Resets. The
[operator request rules](api.md#operator-requests) own admission, the critical
battery rule (including admitting `failsafe`), and `now`. Refusals follow the
[Core API's errors](api.md#basics).

Core retains requested work in its event log and passes accepted requests to the
Asset under the [Core API](api.md#operator-requests).

[Current equipment checks and execution](../../asset/docs/README.md#carry-out-work-and-report-its-result)
remain with the Asset. [Subsystem conditions](../../asset/docs/status.md) do not
automatically gate commands. Configured [failsafes](../../asset/docs/failsafes.md)
remain with the Asset runtime, including while disconnected from Core.
This follows
[decisions near their source](../../atlas/CHARTER.md#keep-the-systems-replaceable).
