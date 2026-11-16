# Build order after the first version

The owner decided this order on 2026-11-14
([decision log](decision-log.md#build-and-test)). The numbered steps are the
working plan for carrying it out.

Protocol, Core, and the SDK, with their simulations, form the built first version
([Design decisions](design-decisions.md#design-the-whole-product-then-build-it)).
This page orders the parts that follow.

## The target is the full simulation

[The goal](goal.md#how-we-know-it-works) says how Atlas is shown to work: a
simulation of a whole operation that runs the real code of every part, with no
real hardware. The Asset app now runs over IP; the gateway app and Fieldlinks
are still unbuilt. The build order aims to make the full simulation runnable
as soon as possible.

## Decided: the parts the full simulation needs come first

After the first version, the Asset app, the gateway app, and the Fieldlinks
are built before the Command Interface.

The cost is that nobody can use Atlas by hand until the Command Interface is
built. Until then the owner judges Atlas from simulation results.

## Two risks the order must answer

1. **Do Atlas Tasks and failsafes fit a real autopilot?** The initial Asset
   runtime now runs against ArduPilot SITL. The
   [Asset simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/docs/asset.md#run-the-initial-sitl-scenarios)
   document the verified scenarios and remaining conformance target. Hardware
   behavior remains unverified.
2. **How much does the radio really carry?** The [Meshtastic bench work](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/meshtastic/README.md#radio-measurement) addresses the unknown radio capacity.

## The Meshtastic Fieldlink comes first

Meshtastic is the first Fieldlink, and SiK is built on what it establishes.
Meshtastic is the fuller Fieldlink and is closer to the Fieldlinks Atlas will
see later, so the gateway app and the simulated radio link are shaped by it.
Building for SiK first would shape them around SiK's one-drone,
point-to-point link.

The [Meshtastic folder](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/meshtastic/README.md) owns its design and bench work.

## New failsafe and radio decisions wait

No new failsafe or radio decision is made until the Asset app has run against
simulated ArduPilot and the radio is measured. The decisions already in the
log stay in force. After the results, they are reviewed against what was
found.

## The steps

1. **The Asset app, built whole.** The IP runtime and initial ArduPilot SITL
   scenarios are built; [implementation gaps](https://github.com/atlas-field-systems/atlas/blob/main/asset/README.md#implementation-gaps)
   remain. [Simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/README.md#simulated-assets) now use the
   real app for IP Asset work.
2. **The gateway app and the Meshtastic Fieldlink**, over a simulated radio
   link. Planned; see the [Meshtastic design and bench work](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/meshtastic/README.md).
3. **The SiK Fieldlink.** Planned.
4. **Simulation tools and the full simulation.** The existing harness runs
   Core, SDK, and Asset IP scenarios. Radio simulation and tools for writing
   the full operation remain planned. That operation has Assets take off and
   make Observations, other Assets tasked onto them, Fusion making Tracks,
   a radio link failing, and hardware faults.
5. **The Command Interface.** Planned; no application code yet.
6. **First flight in the field** ([First flight](first-flight.md)). Planned.

Each part is still built whole, as the design decisions say.
