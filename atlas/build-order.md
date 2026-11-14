# Build order after the first version

> **Proposal.** The owner has not decided this page. It proposes what to build
> after the [first version](design-decisions.md#design-the-whole-product-then-build-it),
> and it ends with the questions only the owner can answer. Decided answers go
> in the [decision log](decision-log.md), and this page is folded into
> [Design decisions](design-decisions.md).

The first version is Protocol, Core, and the SDK, with their simulations. No
page yet orders the parts that follow. This page proposes an order that
answers the riskiest questions first.

## Three questions can still overturn the design

Core is the part least likely to surprise anyone, and Core is built. The
questions below are open, and each one could force a redesign of pages that
are already detailed.

1. **Can one operator do the job from the screen?** The Command Interface is
   the only part the owner can judge by using it, and it has no code. Until a
   screen exists, the owner approves descriptions of a product, not the
   product.
2. **Do Atlas Tasks and failsafes fit a real autopilot?** The decision log
   holds 19 failsafe decisions, made between 2026-11-10 and 2026-11-13. None
   has run against ArduPilot, real or simulated. One was reversed two days
   after it was made: a failsafe response went from always protective to any
   command.
3. **Can the radio carry the fleet?** The design sizes are
   [about 20 Assets, a report about every 15 seconds, and frames of about 200
   bytes](scale.md). The Meshtastic page lists how many Assets the link
   carries as
   [not designed yet](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/meshtastic/README.md#not-designed-yet).
   A rough estimate says the sizes may not fit. Meshtastic's default
   long-range setting carries about 1 kilobit per second, so one 200-byte
   frame takes about 1.5 seconds of air time. Twenty of those frames need
   about 30 seconds of air time in every 15-second window, before any Task,
   acknowledgement, or relayed frame. A faster setting carries more over a
   shorter range. The estimate is not a measurement, and only a measurement
   settles the question.

## The proposed order

1. **Finish the first version as decided.** No change. Protocol and Core are
   built, and the SDK and its simulations are in review.
2. **Fly first flight in simulation, as a throwaway.** Put a rough map screen
   and a simulated ArduPilot quadcopter on the built Core and SDK. The owner
   drafts Takeoff, Move To, and Land, sends them, and watches the reports
   come back. The owner also triggers a low battery and a lost link. The run
   answers questions 1 and 2. No code from it is kept, and the findings go
   back into the docs, as [Rapid prototyping](design-decisions.md#rapid-prototyping)
   says. The owner chooses who builds it.
3. **Measure the radio on a bench.** With two or three Meshtastic radios,
   measure how many 200-byte frames arrive per minute at each radio setting,
   and write the numbers into [Scale](scale.md) and the Meshtastic page. The
   measurement answers question 3. It needs hardware and a person, and it can
   run at the same time as step 2.
4. **Hold new failsafe and Fieldlink decisions until steps 2 and 3 report.**
   The decisions already in the log stay in force. After the reports, review
   them against what was found and reverse those that the findings contradict.
5. **Build the remaining parts whole, in this order.**
   1. The Asset app, tested against simulated ArduPilot over IP.
   2. The Command Interface. With the Asset app it gives a complete first
      flight in simulation, with no radio.
   3. The gateway app and the SiK Fieldlink, which add the radio hop. First
      flight in the field follows.
   4. The Meshtastic Fieldlink, designed from the bench numbers. The
      [first shared picture](goal.md#how-to-tell-it-works) follows.

## What this changes

The proposal reverses no decision. The first version keeps its order, and each
part is still built whole. Step 2 is a throwaway prototype, which the design
decisions already allow.

The proposal adds three things for the owner to decide: an order for the parts
after the first version, a pause on new decisions in two areas, and a bench
measurement that Atlas does not have today.

## Questions for the owner

1. May a rough, throwaway version of first flight in simulation be built next,
   so that you can use Atlas before the Asset app and Command Interface are
   built properly?
2. Do you have Meshtastic radios to bench-test, and can you or someone else
   run the measurement?
3. Do you agree to make no new failsafe or radio decisions until those two
   results are in?
4. After that, is the order Asset app, Command Interface, gateway with SiK,
   then Meshtastic the order you want?
