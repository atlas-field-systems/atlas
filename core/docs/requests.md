# Request admission

Selected behavior for the future Core runtime, not the retained prototype.

Core rejects requests it can establish are invalid before forwarding them over
the field link. It uses shared SDK validation for request formats and parameters,
then checks authentication, Asset connection readiness and contact, explicitly
advertised commands, supported settings, Task identities, and queue rules using
the information it holds.

Core retains requested work and forwards accepted requests unchanged under
[Protocol's exchanges and acknowledgements](../../protocol/docs/communication.md#operator-interfaces).

[Current equipment checks and execution](../../asset/docs/README.md#carry-out-work-and-report-its-result)
remain with the Asset. [Subsystem conditions](../../asset/docs/status.md) do not
automatically gate commands. Configured [failsafes](../../asset/docs/failsafes.md)
remain with the Asset runtime, including while disconnected from Core.
The runtime may be ground-based, as in the [first-flight setup](../../atlas/first-flight.md).
This follows
[decisions near their source](../../atlas/design-decisions.md#decisions-stay-near-their-source).
