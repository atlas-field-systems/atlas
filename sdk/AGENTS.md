# Working on the Atlas SDK

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The SDK is the TypeScript client for the Core API. Endpoints and wire behavior
  live in [the Core API doc](../core/docs/api.md); records and the validator live
  in [Protocol](../protocol/README.md). Link to them; do not restate them here.
- Fieldlinks and gateway design are not part of the SDK.
- [README](README.md) is the overview and doc map. Each part of the SDK has one doc
  in `docs/`. Put a new rule in the doc for its part and link to it from elsewhere.
- Runtime is built. The owner requested implementation on 2026-11-14.
- The SDK is not released yet. How it is tagged is decided when it has code.
- Do not merge without the developer's approval.


Run `npx tsc --noEmit`, `npm run check:browser`, and `npm test`.
Keep the queue contract test here. Integration scenarios belong in Simulations.
