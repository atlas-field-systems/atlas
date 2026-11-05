# Core docs

## Prototype layout

- Stack: Node 24, `ws` for WebSockets, Ajv for checking messages, built-in `node:sqlite` for storage. No build step, no browser dependencies.
- `protocol/`: the protocol repository as a git submodule, pinned to a Protocol release tag (`v<major.minor>.<patch>`). Messages are checked against its `definitions/`; nothing is defined here.
- `src/core.mjs`: one WebSocket per Asset (`/asset`) or operator interface (`/operator`). Credentials go in the first message (admin.hello or admin.operator_hello), never the URL. Operators get each Asset's description (today as `admin.asset` without keys; Protocol 0.8 replaces that with keyless `admin.describe` — see [findings](findings.md)). A newer link for the same ID replaces the older one.
- `src/store.mjs`: tables `assets`, `tasks`, `telemetry`, `history`, plus the newest report of each kind per Asset.
- `src/dedupe.mjs`: each `(sender, seq)` is handled once.
- `sim/asset.mjs`: a simulated drone. Default failsafes: link loss returns home, low battery (below its threshold, while flying) lands in place. It sends telemetry every `telemetry_every_s` (0.5 s by default, in sim time), on the ground too. Reports other than telemetry wait in an outbox while the link is down. `src/operator.mjs`: a small operator client. `public/index.html`: the operator page.
- Core refuses a repeated `task_id` from an operator with a reason (Protocol decisions, 0.6).
- `test/`: end to end over real sockets.
- `.github/workflows/protocol-bump.yml`: when Protocol has a newer release tag, moves `protocol/` to it, runs the tests, and opens or updates the `protocol-bump` PR. Core never follows Protocol's main.
- `.github/workflows/release.yml`: `git push origin main:production` releases Core. It checks that `protocol/` is on a Protocol release tag, runs the tests, tags `v<version>` from `package.json`, and writes a GitHub release. Only commits on main are released, and `production` cannot be force-pushed or deleted. A rerun finishes a release whose GitHub release is missing.

[findings.md](findings.md) lists protocol gaps found while building.
