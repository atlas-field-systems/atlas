# Request admission

This behavior is selected but not implemented.

Core rejects requests it knows are invalid before they reach a field link. It
validates request bodies with Protocol's validator, then checks the
caller's session or key, the Asset's contact, explicitly advertised commands,
supported settings, and Task identities using the information it
holds. Refusals follow the [Core API's errors](api.md#basics).

Core retains requested work in its event log and passes accepted requests to the
Asset under the [Core API](api.md#operator-requests).

[Current equipment checks and execution](../../asset/docs/README.md#carry-out-work-and-report-its-result)
remain with the Asset. [Subsystem conditions](../../asset/docs/status.md) do not
automatically gate commands. Configured [failsafes](../../asset/docs/failsafes.md)
remain with the Asset runtime, including while disconnected from Core.
This follows
[decisions near their source](../../atlas/design-decisions.md#decisions-stay-near-their-source).
