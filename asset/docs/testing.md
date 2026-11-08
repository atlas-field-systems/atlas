# Asset testing and CI

Hardware-free tests and scenario evals are selected requirements for the Asset
runtime. No runtime, test bench, or Asset CI job is built yet.

Simulated equipment implements the same equipment-driver interfaces used by real
hardware. Scenarios drive the configured app through its normal interfaces and
observe state, reported outcomes, and diagnostic evidence. The first setup models
the ground Pi's Wi-Fi connection to Core and its separate SiK equipment link to
the quadcopter. Tracker scenarios also cover the minimal reporting-only case.
Hardware testing remains necessary to check the real equipment integration.

## Repeatable scenarios

The test bench controls equipment observations, time, and link faults so scenarios
can run without hardware or live external services. It supports interactive
inspection and automated runs in CI. Scenario inputs and expected outcomes stay
in the repository so failures can be reproduced locally.

Tests and evals check behavior against the owning docs. Initial coverage includes:

- Configuration, dependency startup order, partial startup cleanup, and shutdown.
- Local configuration inspection without equipment movement, including missing
  configuration and effective settings with secrets removed.
- Connecting before GPS or other equipment is ready, losing a fix, and recovery
  without presenting an old position as a new measurement.
- Source and measurement age retained through local state updates and reporting.
- Task execution, observed completion, failure, cancellation, configured
  failsafes, and refusal of work after a failsafe locks the operation.
- Link loss and reconnect while local execution continues, with required outcomes
  delivered through the SDK.
- Separate loss of the Core connection and the vehicle equipment link, including
  a reachable Pi with unavailable vehicle state or control.
- Rapid local updates with slower reporting, sensor overload, and the selected
  overflow behavior.
- Communications choices as paths become available, degraded, or unavailable,
  once their interfaces and policies are defined.
- Reporting priorities under congestion and configured relay resource limits,
  once the SDK and transport policies are defined.
- [Independent flight-controller protections](failsafes.md#independent-flight-controller-protections)
  under Asset-app failure, cancellation and the work lock after detected autopilot
  takeover, and interactions with Atlas responses.

CI runs the tests and scenario evals as the corresponding behavior is implemented.
Failures retain inputs, expected and observed results, and diagnostics for review.
Evals must name the behavior they assess and their pass criteria. Tools, scenario
formats, and thresholds remain open. A simulated pass does not prove real flight
behavior, radio performance, or mesh routing.
