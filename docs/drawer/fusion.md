# Fusion and Tracks

**Keep room.** Core serves Observations only
([ADR-0022](../adr/0022-core-serves-observations-only-fusion-and-tracks-wait-in-the-drawer.md)).
Fusion, Tracks, and Track history wait here until real multi-source Fusion is
designed.

## Ideas to keep

- **Replaceable module inside Core.** Fusion would run inside Core's inner wall,
  follow `report.observation` events, and combine Observations from one or more
  Assets into Tracks. Nothing outside Fusion would write, edit, or remove a
  Track.
- **Tracing a sighting to the ground.** Fusion could use terrain elevation from
  the [terrain Plugin](ground-elevation.md), together with the observing
  Asset's position, altitude, and sensor direction, to estimate where an
  observed object sits on the ground within the sensor's accuracy (for example,
  locating a parked car seen from a survey drone). A target's missing altitude
  remains unmeasured; terrain data alone does not establish that the target is
  on the ground.

## Open

The Track design is worked out when Fusion is built: record shape, association
and merging across Assets, removal, history, and how the operator interface
displays Tracks beside Observations.

Out of the drawer when: multi-source Fusion and the Track design are specified
and adopted by Core and Protocol.
