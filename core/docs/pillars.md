# Core pillars

**Built.** Core is built from pillars. Each pillar owns one part of Core's state behind a
small interface, so one can be rebuilt without rebuilding the others. All of them
run in Core's one process, inside the
[inner wall](../../atlas/design-decisions.md#a-walled-city).

| Pillar | Owns |
| --- | --- |
| Entities | The shared picture: Assets with their descriptions, contact, reports, and settings; Observations; Tracks; and geo features |
| Tasks | Tasks, each Asset's queue, and cancels |
| Objects | Files Core holds, what each one is, and the geo feature it is attached to |
| Fusion | Turning Observations into Tracks ([Fusion](fusion.md)) |
| Administration | Accounts and their password hashes, sessions, Asset, gateway, and Plugin keys, and provisioning. Administrative work Core adds later goes here too |

All five are part of the product and are built together.

The public API reaches Entities, Tasks, Objects, and Administration at their own
root paths: `/entities`, `/tasks`, `/objects`, and `/administration`. Fusion has
no public root; it works on Core's state through the pillars' functions. Plugins
are not a pillar and still have a root path, `/plugins`. Kinds a pillar owns live
under its root, so Assets are at `/entities/assets`. See [Root paths](api.md#root-paths).

[Objects](api.md#objects) and the [Plugin interface](api.md#plugins) are in
the Core API.

## Rules

- A pillar owns its tables. Another pillar reads or changes that state only
  through the owning pillar's functions, never its tables.
- Storage and the event log belong to no pillar, and every pillar writes through
  them. Core writes a change and its event in one transaction
  ([storage](storage.md)), even when the change spans pillars, such as a Task
  that names a geo feature.
- A pillar that reacts to another's changes, as Fusion reacts to Observations,
  follows the event log like any other reader.
- The [Core API](api.md) and the Plugin interface call the pillars' functions
  and keep no state of their own.

Plugins are not a pillar. They run in the second ring, each in its own container
if it needs one, connect out to Core with their own keys, and reach the pillars
only through the Plugin interface ([Plugins](../../atlas/plugins.md)). Administration
keeps each Plugin's key, description, and contact in its `plugins` table, and the
Plugin interface serves them under `/plugins`. Plugin calls and answers are
stored only as events, like Asset reports.
