# Atlas project charter

Atlas helps operators understand field systems, request work, and retain evidence.

Repeated rebuilds produced documentation the project owner could not keep reading.
This repository gives Atlas a short, readable account of what it is for and the
environment in which its parts work together.

## Read the operating picture

1. [The charter](CHARTER.md) defines purpose, scope, and document ownership.
2. [Operating environment](environment.md) explains field links and current assumptions.
3. [Using Atlas](using-atlas.md) shows the parts and their responsibilities.
4. [First flight](first-flight.md) follows the first useful workflow.

## Find a subsystem's documentation

[Subsystem planning in Atlas Core](https://github.com/atlas-field-systems/atlas-core/tree/main/docs)
holds the Entities, Tasks, Objects, and Plugins stories and the run lifecycle plans.
It preserves selected decisions, proposals, and open questions separately.
Protocol, Core, and SDK retain their existing implementation references in that repository.

Subsystem behavior belongs with its owning system. This charter supplies the shared
context that an agent needs before designing that behavior.
Contributors read [AGENTS.md](AGENTS.md).

## Read intended use as intended use

These pages describe the owner's intended use of Atlas. They do not prove that a
capability exists. The first flight includes planned commands.
Repository archival, deletion, and replacement remain separate decisions.
