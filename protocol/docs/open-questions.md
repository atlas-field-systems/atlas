# Open questions

What is not decided about the records. Selected answers live in the
[decision log](../../atlas/decision-log.md), the [laws](laws.md), and the
[working choices](decisions.md). Questions about requests, events, and contact
belong to the [Core API](../../core/docs/api.md).

## Unresolved

- **Record types in TypeScript.** Decide how TypeScript code learns record shapes without a hand-written copy that can drift from the definitions. Compare definitions that TypeScript reads directly with a generated types file. The owner allows generated types, as an exception to [no generated code](../../atlas/design-decisions.md#no-generated-code), if the comparison shows that design is better.
