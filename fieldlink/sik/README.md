# SiK Fieldlink

The SiK Fieldlink flies one MAVLink vehicle, such as an ArduPilot quadcopter,
over a SiK telemetry radio. It is the Fieldlink for
[first flight](../../atlas/first-flight.md), and it has only a gateway side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages; this page owns only what is particular to SiK.

**An experimental Fieldlink.** SiK is for trying out a drone that is not
traditionally an Atlas Asset, not for a long-term deployment. The gateway runs
one SiK radio, so a site using SiK flies one drone. Several drones at once
belong on a Fieldlink built for it, such as [Meshtastic](../meshtastic/README.md).

**Planning.** Nothing is built.

## Hardware and software

- **Radio hardware.** A SiK telemetry radio pair: one plugged into the gateway
  computer by USB, the other wired to the flight controller's telemetry port.
  The pair is a point-to-point link, so the gateway carries exactly one vehicle.
- **Radio software.** MAVLink 2 over the SiK firmware. The vehicle runs no Atlas
  software; its flight controller speaks only MAVLink.

## Gateway only

This is a [gateway-only Fieldlink](../README.md#two-kinds-of-fieldlink). It
opens the SiK radio, checks MAVLink signing, and hands the MAVLink connection to
the standard Asset app, which the gateway runs for the vehicle through the
[gateway interface](../../gateway/README.md#the-gateway-interface). The app's
[ArduPilot equipment driver](../../asset/docs/assets.md#ardupilot-quadcopter)
turns the vehicle's MAVLink stream into Atlas reports and Tasks into MAVLink
commands, so queue, failsafe, and every other behavior stay Asset code. The
Asset app's [configuration](../../asset/config.md) is part of the gateway's
configuration for this Fieldlink, so every value that shapes the vehicle's behavior is still set
for that vehicle.

- **Registration.** The first time the gateway hears the vehicle's MAVLink
  heartbeat in a run, the gateway app registers it as a new Asset, and the Asset
  app signs it up with its description.
- **Contact.** The Asset is online while its app runs and the gateway reaches
  Core. Losing the SiK link is not lost contact with Core: the vehicle link is
  reported as a [subsystem](../../asset/docs/status.md) that turns faulted,
  and the flight controller's own
  [ground-station failsafe](../../asset/docs/failsafes.md#independent-flight-controller-protections)
  acts on it. The two links fail independently.
- **Heartbeats.** The Asset app sends the MAVLink heartbeats that flight
  controller failsafe watches, as [failsafes](../../asset/docs/failsafes.md#independent-flight-controller-protections)
  require. Nothing else on the gateway may send heartbeats with that system ID.

## How it meets [what every Fieldlink provides](../README.md#what-every-fieldlink-provides)

- **Radio identity and only that radio speaking.** MAVLink 2 message signing.
  The gateway and the flight controller share a signing key, set when the
  vehicle is prepared. The gateway ignores any message not signed with it, and
  MAVLink's signing timestamps reject replayed messages.
- **Joining.** Setting the shared signing key and pairing the two SiK radios.
- **Definitions hash.** The Asset app runs on the gateway with the gateway's
  definitions, so there is nothing to compare over the radio.

## Scenarios

- Power on the gateway with the SiK Fieldlink, and the vehicle. The vehicle appears as a new
  Asset, registered by the gateway.
- Pull the SiK radio from the gateway in flight. The Asset stays online, its
  vehicle link shows faulted, and the flight controller returns home on its own.
- Send a MAVLink message with the wrong signing key. The gateway ignores it.
- Start the gateway with no SiK radio plugged in. It does not start and says so.

## Not designed yet

- The SiK radio settings: air speed, net ID, and power.
- The exact MAVLink messages the equipment driver uses.

AI agents: read [the Fieldlink AGENTS.md](../AGENTS.md).
