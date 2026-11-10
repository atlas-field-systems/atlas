# Throwaway Atlas Core API spike

Disposable experiment against repository revision `45bd0261c3bed2257e5290e4cc15fc59e0ba94a7`.
Do not merge until the developer asks. Delete `spike/` to remove it.
This prototype sanity-tests the docs and proves nothing about real flight or the product build.
Product docs remain authoritative and unchanged.

## Run the experiments

Use Node 24 and OpenSSL. From the repository root:

```sh
npm ci --prefix spike --ignore-scripts
npm test --prefix spike
```

Node runs the handwritten TypeScript directly. There is no build step or generated
code. The package imports Protocol's existing validator and loads its definitions
as data. Dependencies and the lockfile stay inside this directory. Tests create
short-lived TLS certificates and SQLite databases in the system temporary directory
and remove them when they finish. They trust the test CA explicitly.

The operator and Asset clients communicate with Core over HTTPS. The operator
client is only a test driver, not an SDK or Command Interface implementation.
The Asset double uses controlled equipment observations. No SITL, real vehicle,
Fieldlink, radio, or hardware driver is included.

Lessons-learned issue: https://github.com/atlas-field-systems/atlas/issues/24.

## Review the experiment

- `core/` implements current-state SQLite tables, transactional events, and the HTTP API.
- `asset/` implements the Asset double and its behavior scenarios.
- `client/` contains the thin network client.
- `test/` contains independent integration tests and design probes.
- `REPORT.md` records evidence, gaps, and proposed design changes.

Task acceptance does not establish completion. Equipment outcomes are explicit
inputs to the double, and the tests inspect its reports. Core reads current state
from tables and report queries, never by replaying events. Restart experiments
are fault injection outside the normal operation assumption in
`atlas/using-atlas.md`, heading "An operation runs without restarts".

## Provisional and omitted contracts

Read `core/NOTES.md`, `asset/NOTES.md`, and `REPORT.md` before interpreting results.
A passing test for a stand-in does not select a product contract.

`GET /entities`, Observations, public Tracks, geo features, Objects, Plugins,
Fieldlink authentication, Reset, archive export, and paced history catch-up are
omitted. Gateway provisioning tests do not establish radio Asset authentication.
Fusion may write through internal Entities functions only. There is no public
`/fusion` path, and no real observation-to-track algorithm is claimed.

The definitions-hash recipe, missing administrative request shapes, and settings
support declaration need explicit spike choices. Failsafe policy and local
response identities cannot be represented fully by current Protocol records.
The Asset double records those distinctions in local diagnostics rather than
pretending that incomplete wire records describe the whole behavior.

## Start an interactive Core

Supply a TLS certificate and matching private key. Use a temporary certificate for
local experiments and trust it explicitly in `SpikeClient.ca`. Then run:

```sh
SPIKE_TLS_CERT=/path/to/cert.pem SPIKE_TLS_KEY=/path/to/key.pem \
SPIKE_ADMIN_PASSWORD='local-experiment-password' node spike/run.ts
```

The local listener uses port 8443 by default and prints its address and definitions
hash. `SPIKE_PORT` changes the port. Login as `ADM` through the thin client, then
provision an Asset with `/administration/assets`. The database stays under
`spike/.runtime/`. Credentials are test configuration and are never written into
source files. Deleting `.runtime/` discards the experiment; this is not a Reset API.
