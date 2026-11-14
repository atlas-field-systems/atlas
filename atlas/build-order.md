# Build order after the first version

> **Partly decided.** On 2026-11-14 the owner decided which parts come before
> the Command Interface ([decision log](decision-log.md#build-and-test)). The
> steps under [Proposed steps](#proposed-steps) and the
> [questions](#questions-for-the-owner) await the owner.

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

## Proposed steps

1. **The Asset app, built whole.** Simulations run it against simulated
   ArduPilot over IP
   ([Asset simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/docs/asset.md)).
   The first scenarios are first flight's Takeoff, Move To, and Land, then a
   low battery and a lost link. They answer the first risk.
2. **A bench measurement of the radio.** With two or three Meshtastic radios,
   measure how many 200-byte frames arrive per minute at each radio setting,
   and write the numbers into [Scale](scale.md) and the Meshtastic page. The
   measurement answers the second risk, and it gives the simulated radio link
   real numbers. It needs hardware and a person, and it can run beside step 1.
3. **The gateway app and one Fieldlink**, over a simulated radio link. Which
   Fieldlink comes first is a question for the owner.
4. **The second Fieldlink.**
5. **Simulation tools and the full simulation.** Tools make a whole operation
   quick to write as a scenario. The full simulation then runs: Assets take
   off and make Observations, other Assets are tasked onto them, Fusion makes
   Tracks, a radio link fails, and hardware faults.
6. **The Command Interface.**
7. **First flight in the field** ([First flight](first-flight.md)).

Each part is still built whole, as the design decisions say.

One more proposal: hold new failsafe and Fieldlink decisions until step 1 and
step 2 report. The decisions already in the log stay in force. After the
reports, review them against what was found.

## Questions for the owner

1. Which Fieldlink comes first? SiK is small and matches first flight, but it
   carries one drone. Meshtastic carries many Assets, which the full
   simulation needs, but it is larger and depends on the bench numbers.
2. Do you have Meshtastic radios to bench-test, and can you or someone else
   run the measurement?
3. Do you agree to make no new failsafe or radio decisions until the Asset
   app has run against simulated ArduPilot and the radio is measured?
