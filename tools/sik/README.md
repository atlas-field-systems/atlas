# SiK tool

The SiK tool flies one MAVLink vehicle, such as an ArduPilot quadcopter, from a
Raspberry Pi on the ground over a SiK telemetry radio pair. It is the setup for
[first flight](../../atlas/first-flight.md). [What an Atlas Tool is](../README.md)
is on its own page; this page owns only what is particular to SiK.

**For trying out a drone.** The tool is for testing a vehicle that is not
traditionally an Atlas Asset, not for a long-term deployment. One radio pair is
a point-to-point link, so one tool flies one vehicle. Several Assets at once
belong on a [Fieldlink](../../fieldlink/README.md) built for it, such as
[Meshtastic](../../fieldlink/meshtastic/README.md).

**Planning.** Nothing is built.

## What it runs

- **Equipment.** A SiK telemetry radio pair: one plugged into the Pi by USB,
  the other wired to the flight controller's telemetry port. The vehicle runs
  no Atlas software; its flight controller speaks only MAVLink 2.
- **The standard Asset app** on the Pi, with its
  [ArduPilot equipment driver](../../asset/docs/assets.md#ardupilot-quadcopter).
  The app reaches Core through the SDK over IP, as any
  [Asset on IP](../../asset/docs/communications.md) does, with its own key. It
  registers itself; there is no gateway.
- **A MAVLink adapter** on the Pi. It bridges the Asset app's MAVLink
  connection to the SiK radio on the Pi's serial port. It carries MAVLink only
  and decides nothing.

The radio is an equipment link between the Asset app and the flight
controller, not an Atlas field link. The queue, failsafes, and every other
behavior stay Asset code, set in the Asset app's
[configuration](../../asset/config.md).

## How it behaves

- **Registration.** The Asset app registers the vehicle as a new Asset when it
  starts, as every [Asset on IP](../../atlas/reset-and-identity.md#keys-and-registration) does.
- **Contact.** The Asset is online while its app runs and reaches Core over IP.
  Losing the SiK link is not lost contact with Core: the vehicle link is
  reported as a [subsystem](../../asset/docs/status.md) that turns faulted, and
  the flight controller's own
  [ground-station failsafe](../../asset/docs/failsafes.md#independent-flight-controller-protections)
  acts on it. The two links fail independently.
- **Heartbeats.** The Asset app sends the MAVLink heartbeats that the flight
  controller's failsafe watches, as
  [failsafes](../../asset/docs/failsafes.md#independent-flight-controller-protections)
  require. Nothing else on the Pi may send heartbeats with that system ID.
- **Signing.** MAVLink 2 message signing. The Asset app and the flight
  controller share a signing key, set when the vehicle is prepared. The app
  ignores any message not signed with it, and MAVLink's signing timestamps
  reject replayed messages.
- **Pairing.** Setting the shared signing key and pairing the two SiK radios
  are part of preparing the vehicle.

## Scenarios

- Power on the Pi and the vehicle. The vehicle appears as a new Asset,
  registered by its Asset app.
- Pull the SiK radio from the Pi in flight. The Asset stays online, its
  vehicle link shows faulted, and the flight controller returns home on its own.
- Send a MAVLink message with the wrong signing key. The Asset app ignores it.
- Start the tool with no SiK radio plugged in. The Asset still reaches Core,
  and its vehicle link shows `unknown` until the vehicle answers.

## Not designed yet

- The SiK radio settings: air speed, net ID, and power.
- The exact MAVLink messages the equipment driver uses.
- The adapter itself, and how the tool is installed on the Pi.

AI agents: read [the Tools AGENTS.md](../AGENTS.md).
