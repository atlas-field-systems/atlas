# Atlas project charter

Atlas helps operators understand field systems, request work, and retain evidence.

Repeated rebuilds produced documentation the project owner could not keep reading.
This folder explains what Atlas is for and the environment its parts work in.

## Read the operating picture

1. [The charter](CHARTER.md) defines purpose, scope, and document ownership.
2. [Decision log](decision-log.md) lists the owner's decisions, dated, each with its scope. It is authoritative.
3. [Operating environment](environment.md) explains field links and current assumptions.
4. [Using Atlas](using-atlas.md) shows the parts and their responsibilities in the walled city.
5. [Runs and identity](runs-and-identity.md) explains runs, Reset, what carries over, and how Assets get their IDs.
6. [First flight](first-flight.md) follows the quadcopter flight workflow.
7. [Settings](settings.md) explains quick changes to an Asset's configuration.
8. [Plugins](plugins.md) explains Plugin actions with examples.
9. [Scale](scale.md) gives design targets, such as about 20 Assets.
10. [Design decisions](design-decisions.md) lists project-wide choices, such as proven, lean designs.
11. [Experimental ideas](experimental.md) lists ideas being explored, not committed.

Two pages are proposals that await the owner's decision: [the goal](goal.md),
which says who Atlas is for and how to tell it works, and the
[build order after the first version](build-order.md).

Superseded plans and historical findings are in the [archive](https://github.com/atlas-field-systems/atlas/blob/main/atlas/archive/README.md).
They are never a source for current rules.

## Keep subsystem documentation with its owner

Subsystem behavior belongs with its owning system. This charter gives agents the shared
context they need before designing that behavior.
Subsystem docs keep selected decisions, proposals, and open questions distinct.
Contributors read [AGENTS.md](AGENTS.md).

## Read intended use as intended use

These pages describe the owner's intended use of Atlas. They do not prove that a
capability exists. The first flight includes planned commands.
Repository archival, deletion, and replacement remain separate decisions.
