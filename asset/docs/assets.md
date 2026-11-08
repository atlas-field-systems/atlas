# Assets and their equipment

An Asset reports information and may offer equipment-control capabilities.
One vehicle is one Asset, including its cameras and gimbals. The Command
Interface presents its supported functions together.

## Initial Assets

### Position tracker

A reporting-only Asset is a Raspberry Pi with a GPS peripheral and an uplink.
Its GPS equipment driver obtains measurements. The app maintains its position and
reports it as telemetry through the communications module and SDK.

It accepts no equipment-control commands and has no failsafe, task queue, or live
settings. [Position rules](README.md#position-and-home) cover unavailable fixes.
A radio's participation in the mesh is separate from its Asset capabilities.

### ArduPilot quadcopter

The first setup runs the Asset app on a Raspberry Pi on the ground. It connects
to Core over Wi-Fi and to an ArduPilot quadcopter through a SiK radio link.
The Pi acts as the companion computer, with the radio replacing the cable to
the flight controller. Operation resembles using a ground-control station such
as QGroundControl, without requiring integration with it.

The vehicle is the Asset represented in Atlas, and the Pi hosts its runtime.
Vehicle position and home come from vehicle measurements. An ArduPilot equipment
driver obtains flight-controller state and sends equipment commands. The app
uses observed state to maintain its own state, report to Atlas, and determine
execution outcomes. MAVLink is the proposed equipment interface. Driver
interfaces and connection options remain open.

Wi-Fi carries Atlas SDK traffic to Core. SiK carries equipment commands and state
between the Pi and ArduPilot. These connections can fail independently.
A reachable ground Pi does not prove that the vehicle is reachable or that it
performed a command.

The ground placement makes the runtime accessible for local intervention during
testing. Independent vehicle controls and flight-controller protections remain
part of the flight setup under [failsafes](failsafes.md#independent-flight-controller-protections).
Onboard placement and Atlas field-radio transports are later extensions.

The movement module's copter profile carries out the
[Takeoff, Move To, Land workflow](../../atlas/first-flight.md). ArduPilot handles
flight control and stabilization. Sending a command to the flight controller
proves neither motion nor Task completion.

### Fixed camera turret

A turret reports automatic Observations produced by its own detection software.
Atlas does not implement computer vision. The Asset integrates that software's
results and reports what it observes about targets, separately from its own state.
Video viewing and human annotations are separate from this automatic reporting.

Its initial pointing behavior slews to a requested geographic position or
bearing and elevation. Bearing uses degrees from true north. Elevation uses
degrees above or below the local horizontal. Geographic requests include latitude,
longitude, and altitude with an explicit reference, using
[Protocol's shared units](../../protocol/docs/laws.md).
Any data lookup needed to construct the request happens before the field link.

Pointing completes when equipment measurements confirm the requested aim. The
turret remains aimed there until another command. Following a moving target is a
future behavior. The Asset handles installation orientation, calibration, and
conversion to equipment coordinates through its modules and equipment drivers.
Gimbal pointing reports can use equipment-relative angles without changing the
request's geographic meaning. Exact pointing commands, limits, tolerances, and timeouts remain open.

### ADS-B receiver

A Raspberry Pi with an uplink and an ADS-B receiver, such as an RTL-SDR, reports
Observations about aircraft. Its own position remains its own telemetry, not an
Observation of the receiver. It does not need equipment-control commands to be an
Asset. [Protocol](../../protocol/docs/storage.md#observations-and-tracks) owns the
shared Observation data. Core fusion decides Tracks.

## Modules and equipment drivers

The selected structure is a configurable Asset app on ordinary Linux, composed
of behavior modules. Modules use equipment drivers as tools where hardware
access is needed. Use the full term **equipment driver** to distinguish it from
an operating-system driver.

The app explicitly selects and connects its configured modules and equipment
drivers. Local files do not silently override built-in modules with the same name.
No separate leader module is selected. Use direct interfaces for execution and
equipment access, with subscriptions where several consumers need observations.
A universal internal message bus is not required. Exact interfaces and the full
module catalog remain open.

The communications module manages SDK setup and connection lifecycle, routes
Atlas requests and outgoing reports, and makes SDK contact information and
diagnostics available to the app. It selects reports from the
[Asset's local state](#local-state-and-data-flow) according to
[communications policy](communications.md). The SDK owns shared validation,
identity, delivery, retry, duplicate handling, and transport adapters. The Asset
does not add a second transport retry or offline-spooling system. Behavior
modules own equipment execution.

An equipment driver talks to external equipment and supplies its observed state.
An equipment driver can support acquisition, control, or both. The GPS tracker
needs acquisition and reporting without a movement module. The ArduPilot
quadcopter also needs movement execution. This structure does not require a
separate process or package for each module or equipment driver.

## Local state and data flow

The Asset maintains local state for its own position, subsystem conditions,
Observations about other things, communications, settings, and supported work.
Modules update that state as equipment measurements and execution outcomes arrive.
Local updates can be much more frequent than reports across the field link.
Own position and equipment state remain distinct from domain Observations.

Locally observed values retain their source and measurement time where known.
Reading or receiving an old value does not refresh its measurement time.
Unknown source or time stays unknown. Execution, reporting, and diagnostics use
the same evidence. Freshness limits and local representation remain open.
Shared reports retain Protocol's existing time and identity rules.

The communications module reads this state and selects what to report through
the SDK. Incoming requests reach the responsible behavior module through the
communications module. Execution updates local state, which supplies the reported
outcome. Slower reporting must not slow equipment control or local state updates.

Task state includes the accepted queue and execution outcomes where supported.
The SDK queue helper remains the owner of queue ordering and delivery state;
the app uses that state rather than maintaining a second queue. Current state
does not replace Task outcomes, individual Observations, or diagnostic evidence
that must be retained or delivered. Keep current state available to its consumers
and retain history locally within explicit storage limits. Storage layout, limits,
and overflow behavior remain open.

Sensor processing uses bounded queues where work needs to run independently.
Each queue needs an explicit overflow policy. Superseded camera frames may be
discarded to keep processing current. Task outcomes and diagnostic evidence
require separate overflow policies.

## Startup, shutdown, and installation

The app starts dependencies before their consumers and stops them in reverse
order. It cleans up resources acquired during a partially completed startup.
Modules can start before their equipment is ready, so
[connection readiness](README.md#start-and-connect) remains separate.

A standard Linux service starts the app on boot and supports orderly shutdown.
Automatic process restart during an operation is not selected. Link reconnects
keep the same running app and SDK instance under the
[operation model](../../atlas/using-atlas.md#the-four-pillars).

Installation is repeatable on ordinary Linux, with example configurations for
the tracker and quadcopter. No custom Raspberry Pi image is planned. Packaging,
service configuration, and installation commands remain open. Mission recovery
after process restart is outside the operation model.

[Hardware-free tests and CI evals](testing.md) check these behaviors as the runtime
is built.

## Movement module and profiles

The movement module processes commands that physically move the platform.
Movement profiles supply platform-specific execution behavior and parameters.
A profile is not an autopilot flight mode.

For a copter Takeoff Task, the app coordinates the Task, the movement module uses
its copter profile, and the ArduPilot equipment driver exchanges commands and
state with the flight controller. Observed equipment state determines the
execution outcome. [Preparation and arming](README.md#prepare-and-take-off) are
part of that execution. Configured failsafe responses use the same execution
behavior as ordinary work.

Copters share a command family for their common flight behavior. Fixed-wing
aircraft need a separate command family because takeoff, travel, and landing have
different meanings and success criteria. A movement profile does not silently
reinterpret copter commands as fixed-wing commands. Exact fixed-wing commands
and inputs are not selected yet.

ArduRover ground vehicles, ArduPlane aircraft, and boats are intended extensions.
Gimbal control paths and camera image transport remain open.
Shared exact commands belong to Protocol after their behavior is agreed.

## Configuration and commitments

The Asset selects its modules, equipment drivers, startup behavior, acquisition
and reporting behavior, supported commands, and response policies. The app
explicitly lists the supported commands, independently of which modules and
equipment drivers are configured. Only list commands the configured Asset can
implement.

Configurability does not change shared meanings. Advertised commands, Task
outcomes, subsystem conditions, and enabled failsafe policies keep their agreed
semantics. Configuration is not an alternative command channel. See
[configuration](../config.md) and [behavior](README.md).
