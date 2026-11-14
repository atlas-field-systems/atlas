# The goal

> **Proposal.** The owner has not decided this page. It is written from the
> stories and numbers already in this folder, and it ends with the questions
> only the owner can answer. Decided answers go in the
> [decision log](decision-log.md), and this banner is removed.

The Charter says what Atlas does: it helps operators understand field systems,
request work, and retain evidence. This page says who that is for, why other
tools do not already do it, what Atlas leaves out, and how to tell it works.

## One operator, many mixed Assets, a slow link

Atlas is for a small field team, in practice
[one operator at a time](scale.md#setup), running up to
[about 20 Assets](scale.md#fleet) for [a few hours](scale.md#runs-and-storage).

The Assets are of different kinds: a quadcopter, a position tracker, an ADS-B
receiver, a fixed camera turret
([initial Assets](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/assets.md#initial-assets)).
Most of them sit beyond a radio link that carries one report
[about every 15 seconds](scale.md#radio) and can drop out.

With Atlas, that operator:

- sees every Asset, and what the Assets observe, in one picture
- sends work to any Asset and sees what the Asset reports it did
- keeps a complete record of the run to study afterwards

## What other tools leave out

A ground-control station such as QGroundControl flies vehicles that speak
MAVLink. It does not show a tracker, an ADS-B receiver, and a camera turret
beside those vehicles, it does not combine their reports into
[Tracks](design-decisions.md#evidence-and-conclusions-stay-apart), and it
expects a link that carries a steady stream from each vehicle.

Atlas is worth building only where it does what such a station does not. Three
things set it apart:

- **Mixed Assets in one picture.** A drone and a sensor that never moves are
  both Assets, with the same reports and the same Tasks.
- **Work that survives a poor link.** An Asset holds its Tasks and its
  failsafe rules, so it keeps working and stays protected without contact.
- **An honest record.** Atlas keeps "the operator asked" apart from "the Asset
  reported it happened", and each run leaves a ZIP that explains it.

## What Atlas is not

Each line links to the page that owns the rule.

- Not a flight controller. The Asset app decides motion and the autopilot
  flies ([Charter](CHARTER.md#keep-judgment-sharp)).
- Not a radio. Atlas rides on existing radios through
  [Fieldlinks](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/README.md).
- Not for several sites or several gateways at once ([Scale](scale.md#setup)).
- Not a long-term archive. A run's data leaves Core at
  [Reset](runs-and-identity.md#a-run-and-reset).
- Not a way to approve new work while Core is unreachable
  ([Environment](environment.md#core-is-a-deliberate-dependency)).
- Not a mission planner. Work is single Tasks, with no multi-step Plans
  ([Design decisions](design-decisions.md#work-is-always-a-task)).

## How to tell it works

Three milestones, each one a run a person can watch.

1. **First flight.** One quadcopter takes off, moves, and lands from the
   Command Interface ([First flight](first-flight.md)). First flight proves
   the parts connect. A ground-control station can already do the same, so
   first flight does not prove Atlas's own value.
2. **First shared picture.** One operator runs a quadcopter, a tracker, and an
   ADS-B receiver in one run, with at least one of them over the slow radio.
   The operator sends the quadcopter to a place while following a Track of a
   passing aircraft. One link drops and returns during the run. Afterwards the
   Reset ZIPs alone explain what happened. This milestone is new in this
   proposal.
3. **Full scale.** About 20 Assets for about 2 hours, at the
   [design sizes](scale.md).

## Judge a change against the goal

Ask one question of any new rule, record, or feature: does it help one
operator run many mixed Assets over a slow link, and trust the record
afterwards? A change that does not is out of scope until the goal changes.

## Questions for the owner

1. Is "one operator, about 20 mixed Assets, a slow radio link, a few hours" the
   right one-line picture of who Atlas is for?
2. Are the three points under [What other tools leave out](#what-other-tools-leave-out)
   the reasons you are building Atlas, or is another reason more important?
3. Is "first shared picture" the right second milestone? If not, what would you
   want to watch Atlas do that would convince you it is worth more than a
   ground-control station?
4. Does anything under [What Atlas is not](#what-atlas-is-not) belong in Atlas
   after all?
