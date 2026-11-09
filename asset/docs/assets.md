# Assets and their equipment

An Asset reports information and may offer equipment-control capabilities.
One vehicle is one Asset, including its cameras and gimbals. The Command
Interface presents its supported functions together.

## Initial Assets

### Position tracker

A reporting-only Asset is a Raspberry Pi with a GPS peripheral and an uplink.
Its GPS equipment driver obtains measurements, and the app reports its position
as telemetry. It accepts no equipment-control commands and has no failsafe, task
queue, or live settings. [Position rules](README.md#position-and-home) cover a
lost fix.

### ArduPilot quadcopter

The first setup runs the Asset app on a Raspberry Pi on the ground. The Pi acts
as the companion computer, with a SiK radio replacing the cable to the flight
controller. Operation resembles a ground-control station such as QGroundControl,
without integrating with it. The Pi is a direct-IP Asset and calls the Core API
itself over IP, with no gateway.

The vehicle is the Asset represented in Atlas, and the Pi hosts its runtime.
Position and home come from vehicle measurements. An ArduPilot equipment driver
reads flight-controller state and sends equipment commands, over MAVLink as
proposed. The app uses observed state to keep its own state, report to Core,
and decide outcomes.

The gateway path carries Atlas traffic; SiK carries equipment commands and state
between the Pi and ArduPilot. The two fail independently. A reachable Pi does
not show that the vehicle is reachable or that it performed a command.

Running the app on the ground allows local intervention during testing.
Independent vehicle controls and
[flight-controller protections](failsafes.md#independent-flight-controller-protections)
stay part of the flight setup. Onboard placement is a later extension.

The movement module's copter profile carries out the
[Takeoff, Move To, Land workflow](../../atlas/first-flight.md). ArduPilot handles
flight control and stabilization.

### Fixed camera turret

A turret reports Observations produced by its own detection software; Atlas does
not implement computer vision. Its first pointing behavior slews to a requested
geographic position, or to a bearing in degrees from true north and an elevation
in degrees from the local horizontal. Pointing completes when equipment
measurements confirm the aim, and the turret holds it until the next command.
The Asset handles installation orientation, calibration, and conversion to
equipment coordinates. Following a moving target is a later behavior.

### ADS-B receiver

A Raspberry Pi with an uplink and an ADS-B receiver, such as an RTL-SDR, reports
Observations about aircraft. Its own position is its telemetry, not an
Observation. It needs no equipment-control commands. Core's Fusion decides Tracks.

Observation contracts and pointing commands wait until after first flight, so
the turret and receiver are later Assets.

## Modules and equipment drivers

The Asset app runs on ordinary Linux and consists of behavior modules. Modules
use equipment drivers where they need hardware. Use the full term **equipment
driver** to distinguish it from an operating-system driver.

The app explicitly selects and connects its configured modules and equipment
drivers. Local files never silently override a built-in module with the same
name. There is no leader module and no universal internal message bus. Modules
use direct interfaces, with subscriptions where several consumers need the same
observations.

The communications module owns the Asset's link to Core: the SDK client on IP,
or a Fieldlink on radio. It routes incoming requests to the responsible module,
selects reports from [local state](#local-state-and-data-flow), and supplies
contact and link diagnostics to the app. [Communications](communications.md) has
the detail. Behavior modules own equipment execution.

An equipment driver talks to external equipment and supplies its observed state.
It can support acquisition, control, or both. The GPS tracker needs acquisition
and reporting without a movement module; the quadcopter also needs movement
execution. Modules and drivers need not be separate processes or packages.

## Local state and data flow

The Asset keeps local state for its own position, subsystem conditions,
observations, communications, settings, and its queue and Task outcomes.
Modules update it as equipment measurements and execution outcomes arrive, often
much faster than reports cross the link. Own position and equipment state stay
distinct from Observations of other things.

Locally observed values keep their source and measurement time where known.
Reading or receiving an old value does not refresh its measurement time, and an
unknown source or time stays unknown. Execution, reporting, and diagnostics use
the same evidence.

The communications module reads this state and chooses what to report. Execution
updates local state, which supplies the reported outcome. Slow reporting never
slows equipment control or local updates.

Current state does not replace Task outcomes or diagnostic evidence that must be
kept or delivered. Sensor processing uses bounded queues where work runs
independently, each with an explicit overflow policy. Superseded camera frames
may be dropped to keep processing current; Task outcomes and diagnostic evidence
are never dropped that way.

## Startup, shutdown, and installation

The app starts dependencies before their consumers, stops them in reverse order,
and cleans up after a partial startup. Modules can start before their equipment
is ready, so [connection readiness](README.md#start-and-connect) stays separate.

A standard Linux service starts the app on boot and shuts it down in order. The
service does not restart the app automatically during an operation; a restart
means shutting down the system for evaluation. Link reconnects keep the same
running app.

Installation is repeatable on ordinary Linux, with example configurations for
the tracker and quadcopter. No custom Raspberry Pi image is planned.
[Tests and CI evals](testing.md) check these behaviors as the runtime is built.

## Movement module and profiles

The movement module carries out commands that physically move the platform.
Movement profiles supply platform-specific behavior and parameters. A profile is
not an autopilot flight mode.

For a copter Takeoff Task, the movement module uses its copter profile, and the
ArduPilot equipment driver exchanges commands and state with the flight
controller. [Preparation and arming](README.md#prepare-and-take-off) are part of
that execution. Configured failsafe responses use the same execution as ordinary
work.

Copters share one command family. Fixed-wing aircraft need their own, because
takeoff, travel, and landing mean different things and succeed differently. A
profile never silently reinterprets copter commands as fixed-wing commands.
ArduRover ground vehicles, ArduPlane aircraft, and boats are intended extensions.

## Configuration and commitments

The Asset selects its modules, equipment drivers, startup behavior, reporting,
supported commands, and failsafe policy. It lists its supported commands
explicitly in its description, and lists only commands the configured Asset can
carry out. Configuration does not change shared meanings: advertised commands,
Task outcomes, subsystem conditions, and failsafe policies keep their agreed
meanings. See [configuration](../config.md) and [behavior](README.md).

## Open

- Module and equipment-driver interfaces, the full module catalog, and driver
  connection options.
- Freshness limits, local storage layout and limits, and overflow behavior.
- Exact turret-pointing and fixed-wing commands, gimbal control, and camera
  image transport.
- Packaging, service configuration, and installation commands.
