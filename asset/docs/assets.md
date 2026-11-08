# Assets and their equipment

An Asset reports information and may offer equipment-control capabilities.
One vehicle is one Asset, including its cameras and gimbals. The Command
Interface presents its supported functions together.

## Initial Assets

### Position tracker

The first Asset is a Raspberry Pi with a GPS peripheral and an uplink. Its GPS
equipment driver obtains measurements. The app maintains its own position and
reports it as telemetry through the communications module and SDK.

It accepts no equipment-control commands and needs no task queue or live settings.
It has no failsafe. If GPS position becomes unavailable, it stops sending position
updates and reports the GPS problem through [subsystem conditions](status.md).
Core retains the last reported position as last known, rather than a new fix.
A radio's participation in the mesh is separate from its Asset capabilities.

### ArduPilot quadcopter

The second Asset uses a companion computer, flight controller, and radio uplink.
An ArduPilot equipment driver obtains flight-controller state and sends equipment
commands. The app uses observed state to maintain its own state, report to Atlas,
and determine execution outcomes. MAVLink remains the proposed connection to
ArduPilot. Interfaces for equipment drivers and connection options remain open.

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

Stationary equipment can use a manually configured position. A GPS receiver is
not required when the configured position describes the installation.

## Modules and equipment drivers

The selected structure is a configurable Asset app on ordinary Linux, composed
of behavior modules. Modules use equipment drivers as tools where hardware
access is needed. Use the full term **equipment driver** to distinguish it from
an operating-system driver.

The app starts the configured modules and connects them together. No separate
leader module is selected. Module interfaces, the full module catalog, packaging,
and startup management remain open.

The communications module manages SDK setup and connection lifecycle, routes
Atlas requests and outgoing reports, and makes SDK contact information and
diagnostics available to the app. The SDK owns shared validation, identity,
delivery, retry, duplicate handling, and transport adapters. Modules decide what
to report and how to perform work.

An equipment driver talks to external equipment and supplies its observed state.
An equipment driver can support acquisition, control, or both. The GPS tracker
needs acquisition and reporting without a movement module. The ArduPilot
quadcopter also needs movement execution. This structure does not require a
separate process or package for each module or equipment driver.

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
VTOL behavior and transitions, profile selection and switching, concurrent work
across modules, gimbal control paths, and camera image transport remain open.
Shared exact commands belong to Protocol after their behavior is agreed.

## Configuration and commitments

The Asset selects its modules, equipment drivers, startup behavior, acquisition
and reporting behavior, supported commands, and response policies. The app
explicitly lists the supported commands, independently of which modules and
equipment drivers are configured. Only list commands the configured Asset can
implement.

The example setups start acquisition and reporting automatically and wait for
requested work or a configured failsafe before operational movement. This is a
selected setup, not a restriction on every possible Asset configuration.

Configurability does not change shared meanings. Advertised commands, Task
outcomes, subsystem conditions, and enabled failsafe policies keep their agreed
semantics. Configuration is not an alternative command channel. See
[configuration](../config.md) and [behavior](README.md).
