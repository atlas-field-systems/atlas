# Disposable Core notes

This is a spike against revision `45bd026`, not approved product code. Exact
shared records pass through Protocol's existing `validate` function and loaded
definitions. No validator or shared record is generated.

## Stand-ins and omissions

- Configuration, administration request and read envelopes are handwritten
  stand-ins from the variables named in `core/docs/api.md` — **Basics**, **Reads**,
  and **Accounts and provisioning**. Their exact envelopes are not defined.
- `supportedSettings` is a provisional Core configuration list, defaulting to
  Protocol's settings keys. `protocol/definitions/records/description.json` has
  no supported-settings declaration despite `core/docs/requests.md` — **Request
  admission** requiring one. This cannot establish per-Asset support on the wire.
- The definitions hash uses sorted indexed schema paths and parsed JSON. The
  docs require agreement but do not choose canonical hash bytes or algorithm
  (`core/docs/api.md` — **Basics**).
- Gateway provisioning optionally takes `asset_ids`. Its credential is restricted
  to those Assets. The binding is provisional because `core/docs/api.md` — **Not
  defined yet** explicitly leaves that binding open. A provisional
  `POST /entities/assets/{id}/contact` accepts `{online,last_heard}` from that
  gateway; direct Asset traffic uses Core receive time. No Fieldlink is built.
- `entities.putTrack` is a provisional internal write seam with an uncommitted
  record shape and `track.provisional` event. No public Fusion path or production
  Fusion algorithm exists. Entities, Objects, Plugins, Reset, report catch-up
  scheduling, retention and archives are omitted where not designed.
- Session/account/key administration uses extra provisional audit event names.
  Reports retain exact Protocol shapes. Route responses, including refusals, are retained across restart, scoped to caller
  and run. Refused route mutations roll back to a savepoint before the refusal
  response is cached. Authentication, malformed transport and compatibility errors
  before a validated caller/key/body are not cached.
- All rows belong to run 1; no Reset is implemented. SQLite startup does not
  rebuild current state from events. Events are append-only through SQLite
  triggers; disabling triggers through privileged database access is outside
  the API's boundary.
- Diagnostics use the supplied structured callback. Log archive, rotation,
  debug endpoint and full production logging are not implemented.

## Credential response retention conflict

`core/docs/api.md` — **Basics** requires retaining every idempotency response for
the run, while **Callers and credentials** says keys are shown once and Core
stores only their hashes. A provisioning retry must recover the response to be
useful, but that response contains its raw key. The spike retains successful
response JSON, including provisioning keys and login Set-Cookie, in
`idempotency_keys`; the primary credentials tables store only hashes. This is a
visible stand-in and security limitation, not a selected resolution. The owner
needs to decide credential issuance/retry semantics before a product build.

## Verification

`core.test.ts` cites behavioral sources directly and exercises metadata
attribution, report-batch rollback, append-only enforcement, paused HTTPS SSE
readers, backpressure closure and persisted-cursor recovery. Parent integration
tests exercise concurrent fleets, authentication, contact expiry, restart,
report history, stream resume and actual Asset-double traffic.

Latest reads use SQLite window queries over indexed events. Partial settings
are merged by each field's report time and event order. This is correct for the
spike but is not performance evidence: query plans and large history workload
cost still need investigation before selecting a production query strategy.
