# Asset testing and CI

Hardware-free tests and scenario evals are selected requirements for the Asset
runtime. No runtime, test bench, or Asset CI job is built yet.

## ArduPilot SITL and simulated equipment

Quadcopter tests run the Asset app against ArduPilot SITL, through the same
ArduPilot equipment driver used with the real flight controller. Other equipment
uses simulated equipment drivers that implement the same interfaces as the real
drivers. Scenarios drive the configured app through its normal interfaces and
observe its state, reports, and diagnostics.

The first tests connect the app to Core directly over IP, as in
[first flight](../../atlas/first-flight.md); the gateway path joins when the
gateway exists. Tracker scenarios cover the minimal reporting-only case.
Hardware testing is still needed for the real equipment, radios, and flight.

## Repeatable scenarios

The test bench controls equipment observations, time, and link faults, so
scenarios run without hardware or live external services, interactively or in
CI. Scenario inputs and expected outcomes live in the repository, so a failure
reproduces locally. Tests check behavior against the owning docs. Initial
coverage:

- Configuration, startup order, partial-startup cleanup, and shutdown.
- Local configuration inspection without moving equipment, including missing
  options and secrets removed.
- The [connect sequence](README.md#start-and-connect), including a definitions
  mismatch, and connecting before GPS or other equipment is ready.
- Losing a GPS fix without presenting an old position as new, and source and
  measurement time kept through reporting.
- Tasks arriving out of order, more than once, or without the rest of their
  request, Tasks sent before a clear, Tasks run with `now`, including `now` at
  the 64-Task cap, cancel by `task_id`,
  repeated events, and a `task_id` never running twice.
- Task completion, failure, and the cancellation of the remaining Tasks.
- Configured failsafes, the operator overrides allowed in failsafe state, and
  refusal of other work. Restore contact after activation, then lose it again;
  expect the latch and ordinary-work lock to remain, with no repeated equal- or
  lower-priority response. Then override with Hold now, lose contact again, and
  expect the contact-loss rule to fire again
  ([re-arming](failsafes.md#an-override-with-hold-or-pause-re-arms-protection)).
  Check higher-priority interruption separately under
  the [selected priority rules](failsafes.md#a-failsafe-activates-a-configured-task).
- The Fail-safe command: the Asset enters failsafe state and runs its built-in
  safe action, and refuses a second Fail-safe.
- Kill the app in flight and on the ground. In flight, it restarts, rejoins
  with the same `asset_id`, and fires its failsafe; on the ground, it drops its
  queued Tasks. In both, the flight controller's own failsafe fires if the app
  stays down past its timeout.
- A [Task update](README.md#carry-out-work-and-report-its-result) for a queued
  Task, the active Task, and a Task that has ended.
- Link loss and reconnect while local execution continues, with final reports
  resent until acknowledged and history catch-up in report batches.
- Separate loss of the Core path and the vehicle equipment link, including a
  reachable Pi with no vehicle state or control.
- Fast local updates with slower reporting, sensor overload, and the selected
  overflow behavior.
- [Independent flight-controller protections](failsafes.md#independent-flight-controller-protections)
  under Asset-app failure, and an autopilot takeover during work or during an
  Atlas response.

CI runs these as the behavior is built. A failure keeps its inputs, expected and
observed results, and diagnostics for review. Each eval names the behavior it
assesses and its pass criteria. A simulated pass does not prove real flight,
radio performance, or mesh routing.

## Open

- Test tools, scenario formats, and eval thresholds.
- Scenarios for several links and congestion, once the gateway and Fieldlink
  designs exist.
