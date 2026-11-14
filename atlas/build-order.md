# Build order after the first version

The owner decided this order on 2026-11-14
([decision log](decision-log.md#build-and-test)). The numbered steps are the
working plan for carrying it out.

The first version is Protocol, Core, and the SDK, with their simulations
([Design decisions](design-decisions.md#design-the-whole-product-then-build-it)).
This page orders the parts that follow.

## The target is the full simulation

[The goal](goal.md#how-we-know-it-works) says how Atlas is shown to work: a
simulation of a whole operation that runs the real code of every part, with no
real hardware. That simulation cannot run until the Asset app, the gateway
app, and a Fieldlink exist. The build order aims to make it runnable as soon
as possible.

## Decided: the parts the full simulation needs come first

After the first version, the Asset app, the gateway app, and the Fieldlinks
are built before the Command Interface.

The cost is that nobody can use Atlas by hand until the Command Interface is
built. Until then the owner judges Atlas from simulation results.

## Two risks the order must answer

1. **Do Atlas Tasks and failsafes fit a real autopilot?** The decision log
   holds 19 failsafe decisions, made between 2026-11-10 and 2026-11-13. None
   has run against ArduPilot, real or simulated. One was reversed two days
   after it was made.
2. **Can the radio carry the fleet?** The design sizes are
   [about 20 Assets, a report about every 15 seconds, and frames of about 200
   bytes](scale.md). The Meshtastic page lists how many Assets the link
   carries as
   [not designed yet](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/meshtastic/README.md#not-designed-yet).
   A rough estimate says the sizes may not fit. If Meshtastic's default
   long-range setting carries about 1 kilobit per second, one 200-byte frame
   takes about 1.5 seconds of air time. Twenty of those frames then need about
   30 seconds of air time in every 15-second window, before any Task,
   acknowledgement, or relayed frame. A faster setting carries more over a
   shorter range. The estimate is not a measurement, and only a measurement
   settles the question.

## The Meshtastic Fieldlink comes first

Meshtastic is the first Fieldlink, and SiK is built on what it establishes.
Meshtastic is the fuller Fieldlink and is closer to the Fieldlinks Atlas will
see later, so the gateway app and the simulated radio link are shaped by it.
Building for SiK first would shape them around SiK's one-drone,
point-to-point link.

## The radio is measured during the build

While the Meshtastic Fieldlink is built, two Meshtastic radios are connected
to the build computer and send messages to each other. Their measured numbers
go into [Scale](scale.md) and the Meshtastic page, and the simulated radio
link uses them. The measurement answers the second risk.

## New failsafe and radio decisions wait

No new failsafe or radio decision is made until the Asset app has run against
simulated ArduPilot and the radio is measured. The decisions already in the
log stay in force. After the results, they are reviewed against what was
found.

## The steps

1. **The Asset app, built whole.** Simulations run it against simulated
   ArduPilot over IP
   ([Asset simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/docs/asset.md)).
   The first scenarios are first flight's Takeoff, Move To, and Land, then a
   low battery and a lost link. They answer the first risk.
2. **The gateway app and the Meshtastic Fieldlink**, over a simulated radio
   link, with the two radios on the bench.
3. **The SiK Fieldlink.**
4. **Simulation tools and the full simulation.** Tools make a whole operation
   quick to write as a scenario. The full simulation then runs: Assets take
   off and make Observations, other Assets are tasked onto them, Fusion makes
   Tracks, a radio link fails, and hardware faults.
5. **The Command Interface.**
6. **First flight in the field** ([First flight](first-flight.md)).

Each part is still built whole, as the design decisions say.
