# Atlas project charter

Atlas helps operators understand field systems, request work, and retain evidence.

Repeated rebuilds produced documentation the project owner could not keep reading.
This folder gives Atlas a short, readable account of what it is for and the
environment in which its parts work together.

## Read the operating picture

1. [The charter](CHARTER.md) defines purpose, scope, and document ownership.
2. [Operating environment](environment.md) explains field links and current assumptions.
3. [Using Atlas](using-atlas.md) shows the parts and their responsibilities.
4. [First flight](first-flight.md) follows the quadcopter flight workflow.
5. [Settings](settings.md) explains quick changes to an Asset's configuration.
6. [Plugins](plugins.md) explains Plugin actions, with examples.
7. [Scale](scale.md) sets how big Atlas is meant to be, such as about 20 Assets.
8. [Design decisions](design-decisions.md) lists project-wide choices, such as proven, lean designs.
9. [Experimental ideas](experimental.md) lists ideas being explored, not committed.

## Keep subsystem documentation with its owner

Subsystem behavior belongs with its owning system. This charter supplies the shared
context that an agent needs before designing that behavior.
Subsystem docs keep selected decisions, proposals, and open questions distinct.
Contributors read [AGENTS.md](AGENTS.md).

## Read intended use as intended use

These pages describe the owner's intended use of Atlas. They do not prove that a
capability exists. The first flight includes planned commands.
Repository archival, deletion, and replacement remain separate decisions.
