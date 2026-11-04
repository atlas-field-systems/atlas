# Core docs

## Prototype layout

- Stack: Node 24, `ws` for WebSockets, Ajv for checking messages, built-in `node:sqlite` for storage. No build step, no browser dependencies.
- `protocol/`: the protocol repository as a git submodule, pinned to a commit. Messages are checked against its `definitions/`; nothing is defined here.
- `src/core.mjs`: one WebSocket per Asset (`/asset`) or operator interface (`/operator`). Credentials come with the link opening.
- `src/store.mjs`: tables `assets`, `tasks`, `telemetry`, `history`, plus the newest report of each kind per Asset.
- `src/dedupe.mjs`: each `(sender, seq)` is handled once.
- `sim/asset.mjs`: a simulated drone. `src/operator.mjs`: a small operator client. `public/index.html`: the operator page.
- `test/`: end to end over real sockets.

[findings.md](findings.md) lists protocol gaps found while building.
