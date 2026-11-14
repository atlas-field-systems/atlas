# Asset simulations

How the [Asset app](../../asset/README.md) is simulated, once it is built. The
[Simulations README](../README.md) owns the shared rules: real parts, a
simulated world, repeatable runs, and every failure kept as a simulation.

## ArduPilot SITL and simulated equipment

Quadcopter simulations run the Asset app against ArduPilot SITL, through the
same ArduPilot equipment driver used with the real flight controller. Other
equipment uses simulated equipment drivers that implement the same interfaces
as the real drivers. Scenarios drive the configured app through its normal
interfaces and observe its state, reports, and diagnostics. Simulated
equipment, time, and link faults let them run without hardware or live
external services, interactively or in CI.

The first Asset simulations connect the app to Core directly over IP. The
gateway path, as in [first flight](../../atlas/first-flight.md), joins when the
gateway exists. Tracker scenarios cover the minimal reporting-only case.

## Scenarios

Each checks behavior its [Asset page](../../asset/docs/README.md) owns.

- Configuration, startup order, partial-startup cleanup, and shutdown.
- Local configuration inspection without moving equipment, including missing
  options and secrets removed.
- The [connect sequence](../../asset/docs/README.md#start-and-connect), including a definitions
  mismatch, and connecting before GPS or other equipment is ready.
- Losing a GPS fix without presenting an old position as new, and source and
  measurement time kept through reporting.
- Tasks arriving out of order, more than once, or without the rest of their
  request, Tasks that arrive after a clear and run normally, Tasks run with
  `now`, including `now` at the 64-Task cap, a 65th held Task reported
  `cancelled`, dropped Tasks that never run, cancel by `task_id`,
  repeated events, and a `task_id` never running twice.
- Task completion, failure, and the cancellation of the remaining Tasks.
- Configured failsafes, the operator overrides allowed in failsafe state, and
  refusal of other work. Restore contact after activation, then lose it again;
  expect the latch and ordinary-work lock to remain, and an equal- or
  lower-priority rule not to interrupt a running response. Then override with Hold now, lose contact again, and
  expect the contact-loss rule to fire again
  ([re-arming](../../asset/docs/failsafes.md#an-override-with-hold-or-pause-re-arms-protection)).
- The flight controller taking over: switch modes outside the app and expect
  operator requests refused and no rule firing; switch back to Guided and expect
  the Asset holding with every rule re-armed
  ([watch only](../../asset/docs/failsafes.md#while-the-flight-controller-is-in-control)).
  Check higher-priority interruption separately under
  the [selected priority rules](../../asset/docs/failsafes.md#a-failsafe-activates-a-configured-task).
- The Fail-safe command: the Asset enters failsafe state and runs its rule for
  the command, or its built-in safe action with no rule that applies, and
  refuses a second Fail-safe.
- A flying Asset with no critical battery rule: Core refuses its Tasks.
- A critical battery rule: override its response, or an earlier one, with Hold
  now or pause while the battery is below the critical level, and expect the
  rule to fire again at once.
- Two critical rules matching at once: only the higher-priority one fires. Make
  a critical rule's response fail while the battery is still critical: the Asset
  returns home, once. Make any other
  rule's response fail: nothing is retried.
- Kill the app in flight: it stays down, Core shows the Asset offline, and the
  flight controller's own failsafe returns it home after its timeout. Start the
  app again on the ground: it rejoins with the same `asset_id` and drops its
  queued Tasks.
- A [Task update](../../asset/docs/README.md#carry-out-work-and-report-its-result) for a queued
  Task, the active Task, and a Task that has ended.
- Link loss and reconnect while local execution continues, with final reports
  resent until acknowledged and history catch-up in report batches.
- Separate loss of the Core path and the vehicle equipment link, including a
  reachable Pi with no vehicle state or control.
- Fast local updates with slower reporting, sensor overload, and the selected
  overflow behavior.
- [Independent flight-controller protections](../../asset/docs/failsafes.md#independent-flight-controller-protections)
  under Asset-app failure, and an autopilot takeover during work or during an
  Atlas response.

## Open

- Eval thresholds, such as how close and how fast counts as a pass in SITL.
- Scenarios for several links and congestion, once the gateway and Fieldlink
  designs exist.
