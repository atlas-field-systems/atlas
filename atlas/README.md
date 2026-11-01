# Atlas project charter

Atlas coordinates field systems: observe what exists, ask Assets to do work,
and retain what they report.

Repeated rebuilds produced documentation the project owner could not keep reading.
This charter gives the overall project a small documentation home whose changes
the owner can understand and review.

## Start here

1. [The charter](CHARTER.md) defines purpose, ownership, and how behavior changes.
2. [Using Atlas](using-atlas.md) shows the applications, Core, gateway, and Asset.
3. [First flight](first-flight.md) follows the first useful workflow.

## Read one system

| Pillar | Story |
| --- | --- |
| [Entities](entities.md) | Assets, Observations, Tracks, and Geofeatures |
| [Tasks](tasks.md) | Request work and learn what happened |
| [Objects](objects.md) | Receive and retrieve complete files |
| [Plugins](plugins.md) | Bring useful information into Atlas |

[History](history.md) belongs under Entities. [Environment](environment.md) and
[operations](operations.md) describe the current testing scope.
[The proposed archive inventory](archive.md) needs owner review.
Contributors read [AGENTS.md](AGENTS.md).

## Status and ownership

This is draft wording for owner review. **Selected direction** records the owner's
stated choices. **Proposed** marks a suggestion. **Open** marks a decision still needed.
Unmarked behavior from old reference documents is not silently adopted.
Flows show responsibilities, not exact wire exchanges.

This documentation repository owns Atlas's overarching product meaning.
[Atlas Core](https://github.com/atlas-field-systems/atlas-core) remains a separate
implementation repository and retains the old reference. Repository lifecycle
changes are separate from approving this charter.

This charter describes intended product behavior. It does not change the current
implementation or claim that new capabilities are already available.
