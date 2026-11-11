# Open questions

What is not decided about the records. Selected answers live in [laws](laws.md)
and [decisions](decisions.md). Questions about requests, events, and contact
belong to the [Core API](../../core/docs/api.md#not-defined-yet).

## Unresolved

- **Subsystem conditions.** Replace the overall `condition` in `report.status` kind `asset` with reports for [the selected subsystem model](../../asset/docs/status.md): declarations, bounds, and partial updates.
- **Failsafe records.** [Selected Asset behavior](../../asset/docs/failsafes.md) needs shared rule settings, Tasks the Asset creates itself (with no `requested_by` account and no `task_id` from Core's numbering), and command-refusal reports. The current definitions encode one trigger and a fixed response list; they do not express combined conditions or parameterized responses. The latch decision is settled: renewed contact never clears failsafe state, ordinary work stays locked for the operation, and equal- or lower-priority matches never start another response. Higher-priority behavior remains as selected in the Asset rules. The record redesign must preserve those rules. A further conflict remains in the fixed response vocabulary: `continue` describes keeping ordinary work, while activation cancels that work. Resolve that vocabulary as part of this record work; this alignment does not select a replacement.
- **The definitions hash.** Decide what the hash covers. If it covers descriptions and examples, a wording fix makes every program refuse every other.
- **Record types in TypeScript.** Decide how TypeScript code learns record shapes without a hand-written copy that can drift from the definitions. Compare definitions that TypeScript reads directly with a generated types file. The owner allows generated types, as an exception to [no generated code](../../atlas/design-decisions.md#no-generated-code), if the comparison shows that design is better.
- **Commands for other equipment.** Define turret-pointing and fixed-wing commands following [the Asset model](../../asset/docs/assets.md).
