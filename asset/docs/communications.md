# Asset communications

Planned behavior, not implemented. The Asset communications module configures
and uses the [SDK and transports](../../sdk/docs/links.md#multiple-transports-and-link-status)
for delivery and routing across available links and mesh paths.

Initial Assets may use only Wi-Fi, only FLRC, or only LoRa. A working single-link
Asset does not depend on solving multiple-link routing or meshing first.

The [first setup](assets.md#ardupilot-quadcopter) uses Wi-Fi between Core and
the ground Pi. Its separate SiK link is an equipment-driver connection to the
flight controller, outside the Atlas SDK transport path.

## Report from local state

Behavior modules and equipment drivers update the
[Asset's local state](assets.md#local-state-and-data-flow). The communications
module reads that state and chooses which reports to send and how often, using
data relevance and available link quality and capacity. Local acquisition and
execution continue independently of reporting frequency.

The communications module configures the SDK with the transports or transport
interfaces available on that Asset. It uses status from the SDK to adapt reporting
and informs other modules when internet access is available for external API calls.

Reporting policy can use changes, time intervals, and available capacity.
Exact thresholds, rates, priorities, and overflow rules remain open. Reducing
measurement traffic does not erase required Task outcomes or turn an old
measurement into a fresh one. Protocol still owns required exchanges and contact
evidence. The SDK owns delivery, retries, and duplicate handling.

The Asset supplies data and reporting priorities to the SDK, which owns shared
scheduling and delivery. Priorities are separate from path selection. Agree them
through scenarios such as a drone landing while its LoRa path is congested,
before selecting an algorithm. Exact interfaces and priority rules remain open.

## A Wi-Fi, FLRC, and LoRa example

An Asset has Wi-Fi with internet access, FLRC, and LoRa. It uses Wi-Fi to Core
and reports in greater detail. Other modules can use internet APIs. The Asset
conserves radio bandwidth for peers while continuing to participate in the mesh.

Farther away, Wi-Fi is unavailable and FLRC provides a usable path to Core.
The Asset exchanges Atlas messages through the SDK and reduces reporting to
fit that path. It does not assume ordinary internet API access over the field
radio. It avoids sending the same Core traffic over LoRa when FLRC already
provides the better path.

When only LoRa provides a usable path, communications is constrained and the
module makes stricter choices about what to send. Paths may pass through other
Assets. A nearby radio peer alone does not prove that Core or the internet is
reachable.

The best path depends on its destination and current conditions, rather than a
fixed ranking of radio types. An Asset's own path to Core and the paths it
provides for peers can differ.

## Decisions still open

- How a transport exposes one or several interfaces and describes their capacity,
  quality, and destination reachability.
- How the app supplies reporting priorities and relay participation limits to
  the SDK and transports.
- Reporting priorities, congestion handling, and fairness between an Asset's
  traffic and traffic it carries for peers.

The [SDK link docs](../../sdk/docs/links.md#multiple-transports-and-link-status)
track routing, relay participation, and transport integration questions.
Core continues to authorize requests for work, including those carried through peers.
