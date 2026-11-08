# Assets and their equipment

This page records the intended equipment and the proposals still under discussion.
No Asset runtime is implemented yet. [Asset behavior](README.md) describes the
current startup and execution draft.

## Intended Assets

The first Asset is a generic quadcopter with an ArduPilot flight controller,
a companion computer running the Asset software, and a radio connection to Atlas.
Its initial work is the [first-flight story](../../atlas/first-flight.md).
A camera and gimbal are a possible addition.

Other intended examples include fixed-wing drones, boats, autonomous ground
vehicles, a stationary camera on a pan-and-tilt mount, and a tracker attached to
a car. These examples include equipment that moves itself, equipment that only
aims a camera, and equipment attached to a vehicle it does not control.

## One vehicle is one Asset

A vehicle appears in Atlas as one Asset. A drone's camera and gimbal are
capabilities of that Asset, alongside flight. They do not become separate Assets
because they have separate hardware connections. This keeps the vehicle's work,
reports, and camera information associated with the same Asset.

## A tracker is a reporting Asset

A tracker attached to a car pushes its position to Atlas, so the car is visible
in the system. It is a beacon: it accepts no equipment-control commands and
does not control the car. An Asset does not need to accept commands to belong
in Atlas.

Depending on its radio equipment, the tracker may also participate in the radio
mesh. That radio role is separate from its position-reporting behavior as an
Asset. Mesh participation does not give it control over the car.

The beacon has no failsafe. Atlas enables no failsafe rules by default; the
[failsafe model](failsafes.md#no-rules-are-enabled-by-default) adds them explicitly
for Assets that support the configured response Tasks.

## Proposed companion-computer layout

Use the name **Asset app** or **Asset runtime** for the software on the companion
computer. The proposal is an application on ordinary Linux, rather than a custom
operating system. Packaging and startup management remain open.

The app uses the Atlas SDK for Atlas communications and an equipment integration
to communicate with ArduPilot using MAVLink. ArduPilot documents this
[companion-computer arrangement](https://ardupilot.org/dev/docs/companion-computers.html).
The app coordinates requested work and interprets equipment reports. ArduPilot
handles flight control and stabilization. How app decisions interact with the
autopilot's own failsafes still needs discussion.

A supported gimbal can be
[controlled through ArduPilot](https://ardupilot.org/dev/docs/mavlink-gimbal-mount.html).
A direct connection to the companion computer is another possibility to evaluate
for the chosen equipment. Neither the gimbal connection nor the camera's image
path is selected.

## Proposed platform integration

The goal is to share the Asset software while allowing different physical
platforms to execute work differently. A shared app on ordinary Linux, with
platform-specific equipment code and configuration, is the proposed starting point.
An integration can share ArduPilot communication code while supplying different
procedures for a copter, fixed-wing aircraft, or VTOL fixed-wing aircraft.

The app owns common Task handling, outcome reporting, and local logging. The
platform integration carries out the operation with the connected equipment and
supplies the observations that establish success or failure. Its exact software
interface and the division between code and configuration are not selected.

For example, [Takeoff preparation](README.md#prepare-and-take-off) includes the
arming and setup that the platform can perform automatically. Physical arming
requirements depend on the platform.

Different local procedures can implement the same Atlas command when they meet
the same requested behavior. Different requested behavior may need different
commands. The developer wants the option of distinct fixed-wing and vertical
takeoff commands, including distinctions between VTOL platforms. Their names,
inputs, and completion rules remain open.

## Implications elsewhere in Atlas

Protocol's existing
[`admin.describe`](../../protocol/definitions/messages/admin/describe.json)
already allows an empty command list and cameras within one Asset description.
No new Asset identity or message shape is needed for those distinctions.

Core retains the drone's capabilities together and retains the tracker's position
reports without treating either receipt as evidence of control. The Command
Interface needs to show the tracker even though it has no control commands, and
offer the drone's supported flight and camera functions through one Asset.

SDK and radio-mesh behavior remain in their owning docs. A device's Asset
capabilities do not describe its radio-routing duties.

The current [first-flight Takeoff](../../atlas/first-flight.md#the-flight-commands)
climbs straight up and holds at the target altitude. That story does not yet
describe a conventional fixed-wing takeoff. Agree on the intended flight behavior
before extending Protocol; do not silently give the same command a different
meaning on another platform. Core and the Command Interface can request supported
work without carrying the platform's flight-controller preparation sequence.

## Questions still open

- What happens automatically at power-on, before any Task runs?
- What evidence can the app obtain from the equipment about physical arming
  requirements?
- Which takeoff behaviors share a command, and which need distinct commands?
- Which behavior is common to all Assets, and which belongs to specific equipment?
  The startup-home and flight-failsafe rules describe the drone, while beacon
  startup and failure behavior still need discussion.
