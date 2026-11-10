# Open questions

What is not decided about the records. Selected answers live in [laws](laws.md)
and [decisions](decisions.md). Questions about requests, events, and contact
belong to the [Core API](../../core/docs/api.md#not-defined-yet).

## Unresolved

- **Settings support.** The description lists commands and reports but not settings, so Core cannot yet tell which settings an Asset supports. Decide how an Asset declares them, separately from the values it knows.
- **Request bodies.** Core validates `POST /assets/{asset_id}/tasks` against Protocol, but the body is a list of Tasks, each without `time`, `asset_id`, `task_id`, `clear_count`, `send_last`, and `requested_by`. Decide whether Protocol defines request bodies as their own records or Core checks the kind against the `task` kinds.
- **Core's own records.** The Core API names records Protocol does not define yet: an Asset being provisioned or removed, and an Asset's contact (online or offline, last heard), including a gateway's contact reports.
- **Subsystem conditions.** Replace the overall `condition` in `report.status` kind `asset` with reports for [the selected subsystem model](../../asset/docs/status.md): declarations, bounds, and partial updates.
- **Failsafe records.** [Selected Asset behavior](../../asset/docs/failsafes.md) needs shared rule settings, Tasks the Asset creates itself (with no `requested_by` account and no `task_id` from Core's numbering), and command-refusal reports. The current definitions encode one trigger and a fixed response list; they do not express combined conditions or parameterized responses.
- **Pause.** Define how a Task interrupted by [pause](../../asset/docs/README.md#pause) is reported. A Task interrupted by a Task with `now` is reported `cancelled` ([Tasks that run now](../../asset/docs/README.md#tasks-that-run-now)).
- **The definitions hash.** Decide what the hash covers. If it covers descriptions and examples, a wording fix makes every program refuse every other.
- **Record types in TypeScript.** Decide how TypeScript code learns record shapes without a hand-written copy that can drift from the definitions. Compare definitions that TypeScript reads directly with a generated types file. The owner allows generated types, as an exception to [no generated code](../../atlas/design-decisions.md#no-generated-code), if the comparison shows that design is better.
- **Commands for other equipment.** Define turret-pointing and fixed-wing commands following [the Asset model](../../asset/docs/assets.md).
