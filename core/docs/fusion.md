# Fusion

This direction is selected but not implemented. The Observation and Track records
are not designed yet. Their earlier definitions wait in
[Protocol's parked folder](https://github.com/atlas-field-systems/atlas/blob/main/protocol/parked/README.md). This page owns how Core processes them.

Fusion is a replaceable module inside Core's inner wall, in Core's process. It
works on Core's state directly, never through the public API.
Fusion combines Observations with other information to produce Tracks. Fusion
also handles reference data, including digital elevation models (DEMs).
Terrain elevation can inform how fusion interprets and combines measurements.
A target's missing altitude remains unmeasured; DEM data alone does not establish
that the target is on the ground.

## Temporary first iteration

The first iteration uses a temporary module that turns every new `asset_id`
and `observation_id` pair into its own track, listing its source. This tests
the Core-to-fusion boundary with a simple implementation.

For a `coordinates` observation, the module copies its position and uncertainty
onto the track. For a `bearing` observation, the track has no position. The
operator interface draws the bearing from the source observation.

## Reference-data decisions still needed

The temporary iteration does not use DEMs. Reference-data sources, access,
availability, accuracy, and fusion algorithms remain open.

## Track freshness

Core decides when retained information is stale. A Track keeps its last sighting
time when delivered or replayed. Silence does not prove the target disappeared.
Core supplies the last sighting and stale status to the
[Command Interface](../../command-interface/docs/README.md).

Freshness thresholds and shared data formats remain
[open](../../protocol/docs/open-questions.md#unresolved).
