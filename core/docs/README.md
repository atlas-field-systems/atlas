# Core docs

This describes the retained runtime, not the current system design.

For the future runtime, [configuration](../config.md) inventories proposed
options and [logging](logging.md) defines the diagnostic evidence to collect.

## Prototype layout

- Stack: Node 24, `ws` for WebSockets, Ajv for checking messages, built-in `node:sqlite` for storage. No build step, no browser dependencies.
- `protocol/`: the Protocol release pinned in `package.json` (`"protocol"`, a historical tag), unpacked by `scripts/protocol.mjs` and ignored by git. `src/protocol.mjs` validates against its `definitions/`; `src/version.mjs` reads its version without loading the validator. Nothing is defined here.
- `src/core.mjs`: one WebSocket per Asset (`/asset`) or operator interface (`/operator`). Credentials go in the first message (admin.hello or admin.operator_hello), never the URL. Operators get each Asset's description (today as `admin.asset` without keys; the current spec replaces that with keyless `admin.describe` — see [findings](findings.md)). A newer link for the same ID replaces the older one.
- `src/store.mjs`: tables `assets`, `tasks`, `telemetry`, `history`, plus the newest report of each kind per Asset. Storage owns report lookup and database shutdown.
- `src/dedupe.mjs`: each `(sender, seq)` is handled once.
- `sim/asset.mjs`: a simulated drone. Default failsafes: link loss returns home, low battery (below its threshold, while flying) lands in place. It sends telemetry every `telemetry_every_s` (0.5 s by default, in sim time), on the ground too. Reports other than telemetry wait in an outbox while the link is down. `src/operator.mjs`: a small operator client. `public/index.html`: the operator page.
- Core refuses a repeated `task_id` from an operator with a reason.
- `test/`: end to end over real sockets, plus storage and lifecycle checks.
- The historical Protocol pin is fixed while the prototype is retained; there is no automatic adoption of the current spec.
- The repository's `.github/workflows/release.yml`: `git push origin main:prod` releases Core if it changed. It checks that the pin is a Protocol release tag, runs the tests, tags `core-v<version>` from `package.json`, and writes a GitHub release. Only commits on main are released. A rerun finishes a release whose GitHub release is missing.

[findings.md](findings.md) lists protocol gaps found while building.
[Fusion](fusion.md) records the selected first implementation, which is not built yet.
