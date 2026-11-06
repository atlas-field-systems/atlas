# Fusion

Selected direction, not implemented in the first-flight prototype.
[Protocol storage](https://github.com/atlas-field-systems/protocol/blob/main/docs/storage.md#observations-and-tracks)
owns observation and track data. This page owns how Core processes them.

Fusion is a replaceable module, run in Docker like the other Core pillars.
Core passes observations in and tracks come out.

The first iteration uses a temporary module that turns every new `asset_id`
and `observation_id` pair into its own track, listing its source. This keeps
the first implementation simple while testing the Core-to-fusion boundary.

For a `coordinates` observation, the module copies its position and uncertainty
onto the track. For a `bearing` observation, the track has no position. The
operator interface draws the bearing from the source observation.
