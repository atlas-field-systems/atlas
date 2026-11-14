# Fusion

**Built.** Core uses the temporary first iteration below. Protocol defines the
`report.observation` and `track` records ([Protocol](../../protocol/README.md#records)).
This page owns how Core processes them.

Fusion is a replaceable module inside Core's inner wall, in Core's process. It
works on Core's state directly, never through the public API.
Fusion combines Observations with other information to produce Tracks. Fusion
also handles reference data, including digital elevation models (DEMs).
Terrain elevation can inform how fusion interprets and combines measurements.
A target's missing altitude remains unmeasured; DEM data alone does not establish
that the target is on the ground.

## What Fusion may do

Fusion follows the event log for `report.observation` events, as any pillar
that reacts to another's changes does ([pillars](pillars.md#rules)). It creates,
changes, and removes Tracks through the Entities pillar's functions. Each change
adds `track.updated`, and each removal adds `track.removed`
([Tracks](api.md#tracks)). A Track's `sources` name the Observations it rests
on. Nothing else writes a Track: not operators, Plugins, or Assets.

## Temporary first iteration

The first iteration uses a temporary module that turns every new `asset_id`
and `observation_id` pair into its own track, listing its source. This tests
the Core-to-fusion boundary with a simple implementation. It never removes a
Track.

The module copies each observation's `entity_type` and details onto the track.
For a `coordinates` observation, it also copies the position and uncertainty.
For a `bearing` observation, the track has no position. The operator interface
draws the bearing from the source observation.

## Reference-data decisions still needed

The temporary iteration does not use DEMs. Reference-data sources, access,
availability, accuracy, and fusion algorithms remain open.

## Track freshness

A Track's `time` is its last sighting, the newest Observation report it uses.
It keeps that time when delivered or replayed. Silence does not prove the
target disappeared, so a Track stays in the picture until Fusion removes it.
Core adds no stale status. The
[Command Interface](../../command-interface/docs/README.md) shows each Track's
age and lets the operator hide old ones.
