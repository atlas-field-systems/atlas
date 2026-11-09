# Core pillars

Core is built from pillars. Each pillar owns one part of Core's state behind a
small interface, so one can be rebuilt without rebuilding the others. All of them
run in Core's one process, inside the
[inner wall](../../atlas/design-decisions.md#a-walled-city). This design is
selected but not implemented.

| Pillar | Owns |
| --- | --- |
| Entities | The shared picture: Assets with their descriptions, contact, reports, and settings; Observations; Tracks; and geo features |
| Tasks | Tasks, each Asset's queue, the list in flight, and cancels |
| Objects | Files Core holds and what each one is |
| Fusion | Turning Observations into Tracks ([Fusion](fusion.md)) |
| Accounts | Accounts, sessions, Asset and gateway keys, and provisioning |

All five are part of the product and are built together. The Core API for
Observations, Tracks, geo features, and Objects is
[not designed yet](api.md#not-defined-yet).

## Rules

- A pillar owns its tables. Another pillar reads or changes that state only
  through the owning pillar's functions, never its tables.
- Storage and the event log are shared ground, not a pillar. A change and its
  event are written in one transaction ([storage](storage.md)), even when the
  change spans pillars, such as a Task that names a geo feature.
- A pillar that reacts to another's changes, as Fusion reacts to Observations,
  follows the event log like any other reader.
- The [Core API](api.md) and the Plugin interface sit on top of the pillars and
  call their functions. Neither keeps state of its own.

Plugins are not a pillar. They run in the second ring, each in its own container
if it needs one, and reach the pillars only through the Plugin interface
([Plugins](../../atlas/plugins.md)).
