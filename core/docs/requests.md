# Request admission

Selected behavior for the future Core runtime. The retained prototype uses a
historical Protocol snapshot and does not implement this design.

Core rejects requests it can establish are invalid before forwarding them over
the field link. The command interface constructs requests through the SDK. Core
uses that same shared validation implementation, then applies its business rules.
It does not build a second schema validator.

## Checks before forwarding

Core checks the request format and required parameters through the SDK. It also
checks authentication, the Asset's connection readiness and contact, explicitly
advertised commands, supported settings, Task identity rules, and queue rules
using the information it holds. Known unsupported commands or invalid bodies
never need a round trip to the Asset.

Supported settings are separate from currently known setting values. An unknown
home does not mean home is unsupported. The exact support declaration remains
[Protocol work](../../protocol/docs/open-questions.md#unresolved), as does the
minimal connection path for Assets with no settings or task queue.

Core forwards accepted requests unchanged and retains the requested work.
Acceptance is not proof of receipt, execution, or success. The
[communication rules](../../protocol/docs/communication.md#operator-interfaces)
own the exchanges and acknowledgements.

## Current equipment decisions stay with the Asset

Core cannot establish what equipment will be able to do when a Task executes.
GPS can become unavailable after a request is accepted. The Asset checks the
required current equipment state, prepares the platform, and reports the observed
outcome under [Asset execution rules](../../asset/docs/README.md#carry-out-work-and-report-its-result).

[Subsystem conditions](../../asset/docs/status.md) are evidence for display and
configured policies, not automatic command gates. An unrelated fault does not
cause Core to reject otherwise supported work. The Asset evaluates configured
failsafes locally, including while disconnected.

This division follows [decisions near their source](../../atlas/design-decisions.md#decisions-stay-near-their-source).
It reduces field traffic without asking Core to predict physical outcomes or
move equipment decisions away from their source.
