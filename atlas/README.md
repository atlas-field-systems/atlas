# Atlas project charter

Atlas helps operators understand field systems, request work, and retain evidence.

Repeated rebuilds produced documentation the project owner could not keep reading.
This folder explains what Atlas is for and the environment its parts work in.

## Read the operating picture

1. [The charter](CHARTER.md) defines purpose, scope, and document ownership.
2. [The goal](goal.md) says who Atlas is for, what it is not, and how to tell it works.
3. [ADRs](https://github.com/atlas-field-systems/atlas/blob/main/docs/adr/README.md) record the owner's decisions, dated and scoped, with why. Accepted ADRs are authoritative. Decisions one part owns are in that part's `docs/adr/`.
4. [Operating environment](environment.md) explains field links and current assumptions.
5. [Using Atlas](using-atlas.md) shows the parts and their responsibilities in the walled city.
6. [Runs and identity](runs-and-identity.md) explains runs, Reset, what carries over, and how Assets get their IDs.
7. [First flight](first-flight.md) follows the quadcopter flight workflow.
8. [Settings](settings.md) explains quick changes to an Asset's configuration.
9. [Plugins](plugins.md) explains Plugin actions with examples.
10. [Scale](scale.md) gives design targets, and how Atlas uses slow links fully and efficiently.
11. [Design decisions](design-decisions.md) lists project-wide choices, such as proven, lean designs.

The [build order after the first version](build-order.md) says which parts
come next.

Superseded plans and historical findings are in the [archive](https://github.com/atlas-field-systems/atlas/blob/main/atlas/archive/README.md).
They are never a source for current rules.

## Keep subsystem documentation with its owner

Subsystem behavior belongs with its owning system. This charter gives agents the shared
context they need before designing that behavior.
Subsystem docs keep selected decisions, proposals, and open questions distinct.
Contributors read [AGENTS.md](AGENTS.md).

## Read intended use as intended use

These pages describe the owner's intended use of Atlas. They do not prove that a
capability exists. The [repository overview](https://github.com/atlas-field-systems/atlas/blob/main/README.md) points to each part's
current implementation status. The first field flight remains planned.
Repository archival, deletion, and replacement remain separate decisions.
