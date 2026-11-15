# Asset simulations

How the [Asset app](../../asset/README.md) is simulated. The
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

## Run the initial SITL scenarios

Use Node 24 and install dependencies with `npm ci` in Protocol, Core, the SDK,
Asset, and Simulations, in that order. From the repository root run:

```sh
node simulations/scripts/fetch-sitl.mjs
cd simulations
node --test sitl/flight.test.ts
```

The downloader pins official Copter 4.7.2 and its default copter parameters by
SHA-256. It stores them in `~/.cache/atlas-sitl`, outside source. Set
`ATLAS_SITL_DIRECTORY` to use another download directory. The binary URL names `stable-4.7.2`; a changed binary fails verification
instead of silently changing the test equipment.

The fifteen scenarios run the real Asset, SDK, Protocol, and a separate Core process.
Each scenario allocates equipment TCP ports from the operating system instead
of reusing fixed ports. Cleanup waits for SITL to exit before the next scenario.
Destination landing and Return to home each end with Core telemetry within
3 metres of the requested position and an archived disarmed measurement. Return
to home first sets Atlas home away from the arming point. Both specify a transit
altitude above takeoff altitude.
SITL runs at five times real time, so its configured GCS heartbeat interval is
0.2 wall seconds. Flight-controller GCS failsafe remains enabled. Low battery
uses SITL's battery consumption with a smaller configured battery capacity.
Core-path loss aborts the Asset's HTTP connection while its equipment TCP link
continues. The idle-gap scenario withholds one Task in the simulated network
while delivering its successor. It checks that the blocked queue does not
suppress the configured idle response. Each scenario prints its temporary evidence directory, including
Core archives and SITL output. Asset shutdown writes its own verified archive.
The boundary scenario flies outside its configured polygon and checks the two-second
condition duration against archived position acquisition times, the Core response
reports, and the final disarmed measurement.
These checks prove simulated behavior only. The remaining scenario list above
is still the conformance target.

The request-answer scenario submits a policy with duplicate priorities that Core
can deliver but the Asset refuses. It checks that retained settings reach Core
with the request ID. After an operator Fail-safe starts a response, it sends an
ordinary Task and a cancel while the simulated network delays outgoing reports.
Core must receive failed Task evidence answering both requests, without the Task
entering the held queue. The takeover scenario also checks the refused Task's
request ID. These delays affect only the network around the real parts.

The subsystem scenario disables SITL GPS through `SIM_GPS1_ENABLE`. Core must
receive a fresh faulted GPS condition and the configured subsystem rule must land.

Equipment scenarios place a TCP proxy between the app and SITL. It cuts the
equipment link during Move To, withholds a command ACK, supplies a simulated
equipment refusal ACK, or starts with the link unavailable. Core must receive
the failed Task and cancellation of its successor. During equipment loss, Core
remains reachable and no telemetry has an acquisition time after the cut. After
restoration, telemetry must resume with new acquisition times. The flight
controller retains its GCS failsafe throughout.

## Reporting-only Core scenarios

`scenarios/reporting-assets.test.ts` runs the real Asset app and Core without
SITL. A stationary installation keeps reporting its configured position after
the ordinary measurement-freshness interval. It sends no home, settings, or
queue report. A simulated gpsd receiver supplies tracker fixes through the
production GPS driver. A detector peripheral supplies position, an Observation,
and files over the production acquisition interface. Core's picture must show
both Assets and the Observation. A file with a place must appear as an Object
linked to that place. A refused capture must remain in the Asset's Reset ZIP.
