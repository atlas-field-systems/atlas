# Fusion

Selected direction, not implemented in the first-flight prototype.
[Protocol storage](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/storage.md#observations-and-tracks)
owns observation and track data. This page owns how Core processes them.

Fusion is a replaceable module, run in Docker like the other Core pillars.
Fusion combines Observations with other information to produce Tracks. Reference
data, including digital elevation models (DEMs), is part of that responsibility.
Terrain elevation can inform how fusion interprets and combines measurements.
A target's missing altitude remains unmeasured; DEM data alone does not establish
that the target is on the ground.

## Temporary first iteration

The first iteration uses a temporary module that turns every new `asset_id`
and `observation_id` pair into its own track, listing its source. This keeps
the first implementation simple while testing the Core-to-fusion boundary.

For a `coordinates` observation, the module copies its position and uncertainty
onto the track. For a `bearing` observation, the track has no position. The
operator interface draws the bearing from the source observation.

## Reference-data decisions still needed

The temporary iteration does not implement DEM use or reference-data fusion.
Data sources, access, availability, accuracy, and algorithms remain open. No new
wire message, Plugin dependency, or reference-data storage format is selected by
this requirement. Protocol continues to own exact shared Observation and Track
data.
