# Protocol decisions

Decisions Lane made for the protocol. When a definition and this page disagree, fix one of them.

## The goal
All Atlas communication flows through this protocol. Improve the protocol, and everything improves.

## Building blocks
- The smallest piece is a **variable**: one named field, defined once in `definitions/variables/`.
- **Components** (`definitions/components/`) group variables, for example the header or an altitude.
- **Messages** (`definitions/messages/`) are built from variables and components.
- Messages and components only reference other files; they never define a field themselves. The check script enforces this, so no field is ever defined twice.
- Each file is JSON Schema (2020-12), with a plain description and at least one example.
- `definitions/index.json` lists every file. The CLI and web viewer read it, so they never hardcode the protocol.

## Every message
- `from`: the sender's `id` and `kind` (asset, operator, core, gateway, or plugin).
- `time`: milliseconds since 1970 (UTC), as a number.
- `seq`: the sender's own counter. `from` plus `seq` is unique, so there is no separate message ID.

## Values
- IDs are long standard IDs (UUIDs) for now.
- Field names are long and readable. Compression handles the length.
- Units: metres, metres per second, degrees from true north.
- Every altitude names what it is measured from: `msl`, `ellipsoid`, `home`, or `ground`. A position may carry more than one altitude.

## Late reports
An older time never overwrites newer state. There is no "history-only" message.

## Settings
- Starting settings: `run_state` (paused/running), `lights` (on/off), `landing_gear` (up/down), `link_loss_response` (return_home/hold/land/continue).
- Each change is an explicit end state, never a toggle. The most recent time wins.
- No custom per-Asset settings yet.

## Versions
- Everything is assumed up to date. There is no backward compatibility.
- There is one version check, at connect. A mismatch is rejected with a clear "update this device" error.

## Tools
The CLI and web viewer only display messages. They never send to a live Core.

## First version
Start with status, telemetry, and settings. Port the rest later.
