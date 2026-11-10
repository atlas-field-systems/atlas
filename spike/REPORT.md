# Lessons from the throwaway Atlas API spike

Source revision: `45bd0261c3bed2257e5290e4cc15fc59e0ba94a7`, confirmed before writing code.
Everything added is under `spike/`. Product docs are unchanged. This is disposable,
must not be merged until the developer asks, and proves nothing on its own.

Final local verification: **40 tests passed, zero failures, skips or cancellations**,
using Node `v24.22.2`. Command: `npm test --prefix spike`.

Report issue: https://github.com/atlas-field-systems/atlas/issues/24.
Confirmed design follow-ups: [queue capacity](https://github.com/atlas-field-systems/atlas/issues/25)
and [credential retries](https://github.com/atlas-field-systems/atlas/issues/26).

## Reproduce the evidence

With Node 24 and OpenSSL, run `npm ci --prefix spike --ignore-scripts`, then
`npm test --prefix spike`. No build or generation step runs. The tests use the
existing Protocol validator with definitions loaded as data. Scenario expectations
are handwritten from the behavior docs, not generated from definitions or examples.

The integration suite in [integration.test.ts](test/integration.test.ts) exercises
24 provisioned Assets with 12 concurrent requests each and 30 simultaneous retries
of one create. A separate scenario runs 20 Asset doubles through four-Task missions,
using real HTTPS, SSE and retried report batches. These are coverage counts, not
throughput measurements or performance guarantees. No benchmark comparison is claimed.

Other scenarios cover batch rollback, report history pagination, clock-ahead
exclusion, final-state monotonicity, auth roles, cross-Asset denial, wrong/rotated
keys, definitions refusal, dropped Tasks/settings/cancels, reconnect repair,
Last-Event-ID, snapshot-then-follow, open-stream contact expiry and dropped-request
filtering. Core restart mid-flight preserves the double's active work and avoids
another execution. Restart is fault injection beyond the normal assumption in
[Using Atlas, An operation runs without restarts](../atlas/using-atlas.md#an-operation-runs-without-restarts).

[Core tests](core/core.test.ts) force backpressure on a paused TLS SSE reader, then
resume after its persisted cursor. Large internal provisional Track events force
this condition. That establishes the bounded-write and resume mechanism; it does
not establish fleet throughput. Asset scenarios in [asset.test.ts](asset/asset.test.ts)
exercise reordered fragments, duplicate events, cancellation before arrival, `now`
while paused, old `clear_count`, failed equipment, settings order, retained batches,
failsafe priority/fallback/latching/overrides, GPS/home, horizontal geofences, missing/stale measurement evidence, and independent
autopilot takeover. Boundary and freshness choices remain local stand-ins.

## Confirmed design problems

### Accepted work can exceed the complete queue-report capacity

[Core API, Operator requests](../core/docs/api.md#operator-requests) admits supported
work while online and sends it immediately. [Asset behavior, Pause](../asset/docs/README.md#pause)
lets queued work accumulate. The complete queue in
[Protocol queue report, queue description and task_ids](../protocol/definitions/records/report/status/queue.json)
is limited to 64 IDs. No aggregate outstanding-work admission rule reconciles these.

The probes **65 individually valid queued Tasks cannot be acknowledged as a complete
queue** in [design-probes.test.ts](test/design-probes.test.ts) and **65 held Tasks
cannot be represented by Protocol queue report** in [asset.test.ts](asset/asset.test.ts)
show the real validator rejecting the required complete acknowledgment at 65 held Tasks.
A per-request cap does not solve accumulation across requests. Truncating the report
would misrepresent work and make dropped-request interpretation unreliable.

Propose an atomic admission rule for total outstanding work, including accepted
in-flight Tasks, or a report contract that represents every permitted queue. This
needs the developer's decision. The spike's provisional per-request cap of 64 does
not resolve the problem. See [Independent design probes](DESIGN-PROBES.md#confirmed-design-problem-accepted-work-can-outgrow-the-queue-report).

### Recoverable credential retries conflict with hash-only credential storage

[Core API, Basics](../core/docs/api.md#basics) requires retaining each response for
run-scoped idempotent retry. [Callers and credentials](../core/docs/api.md#callers-and-credentials)
requires storing only key hashes and showing a key once. The provisioning response
contains the key. Retaining that response makes the key recoverable from storage.
The same tension applies to cached login cookies.

The explicit design probe in [Core tests](core/core.test.ts), **retrying credential
issuance retains recoverable key in idempotency response**, observes the same key
on retry and inside the SQLite response cache. Primary credential tables contain
hashes. [Core notes, Credential response retention conflict](core/NOTES.md#credential-response-retention-conflict)
records this choice as a security limitation rather than a product decision.

Propose choosing credential issuance/retry semantics explicitly. Possible decisions
include making issuance retries return a different non-secret acknowledgment,
recoverable encrypted issuance state with a defined key-management boundary, or a
narrow documented exception to hash-only storage. The spike selects none for the product.

## Documentation conflicts and incomplete contracts

### Recurring link-loss text conflicts with latched failsafe behavior

[Protocol link_loss, description](../protocol/definitions/records/report/failsafe/link_loss.json)
says the trigger can fire again after contact returns.
[Asset failsafes, A failsafe activates a configured Task](../asset/docs/failsafes.md#a-failsafe-activates-a-configured-task)
and [Lock ordinary work for the rest of the operation](../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation)
prohibit another equal/lower-priority response and any exit from failsafe state.
The double follows the Asset behavior and records that choice in
[Asset notes, Doc conflict](asset/NOTES.md#doc-conflict-recurring-versus-latched-failsafe).
This is an explicit conflict, not a claim that both texts are implemented. Reconcile
it with the already-open failsafe-record work before the real build.

### Existing record gaps require visible stand-ins

[Protocol open questions, Unresolved](../protocol/docs/open-questions.md#unresolved)
already lists settings support, request envelopes, hash coverage, subsystem reports,
failsafe policies/local Task identities, pause reporting, and TypeScript shapes.
The experiment confirms those interfaces are needed but does not treat them as new
product defects. [Core notes, Stand-ins and omissions](core/NOTES.md#stand-ins-and-omissions)
and [Asset notes, Provisional stand-ins and untested gaps](asset/NOTES.md#provisional-stand-ins-and-untested-gaps)
list each implemented substitute and omitted behavior.

Settings support uses explicit provisional Core configuration. The unchanged
Protocol description is not extended, and known setting values are not treated as
capability declarations. The definitions hash uses sorted indexed schema paths and
parsed JSON, including descriptions/examples. Its recipe is provisional.
Administration and read envelopes, gateway-to-Asset binding and contact, internal
Track writes, and extra audit event names are also stand-ins.

[Core API, Not defined yet](../core/docs/api.md#not-defined-yet) leaves public picture
shapes, Objects, Plugins, gateway authentication, Reset and catch-up scheduling open.
Those product interfaces are omitted. The gateway key is exercised with a labeled
provisional binding, not a Fieldlink. There is no radio implementation. Fusion has
an in-process Entities write seam and no public path, but no real fusion algorithm.

### ID exhaustion and send_last are documented boundaries

[Protocol laws, law 10](../protocol/docs/laws.md) explicitly caps Task IDs at 9999.
The probe rejects 10000. This is not a newly found defect at the expected workload.
[send_last, description](../protocol/definitions/variables/send_last.json) permits
omission for a Task sent alone, while [Core API, Operator requests](../core/docs/api.md#operator-requests)
says each Task carries it. Core always sends it, satisfying both. This wording
alignment does not justify a separate issue.

## Spike bugs, fixes and remaining limitations

### Bugs corrected during the experiment

Review found that a settings request could overwrite Core-owned metadata, and an
open stream could outlive credential revocation. Core now rejects supplied metadata
and reauthenticates streams. The tests in [core.test.ts](core/core.test.ts), **settings
attribution cannot be supplied by operator**, and [integration.test.ts](test/integration.test.ts),
**definitions refusals, cookie flags, roles, gateway scope, and key rotation**, plus
**key rotation closes an already open Asset SSE stream** in Core tests, cover
the relevant request boundaries. These were prototype bugs, not evidence that the
documented identity model is wrong.

The initial snapshot query materialized report history in JavaScript. It now uses
SQL window queries and an index, following [Core storage, Every change writes one event](../core/docs/storage.md#every-change-writes-one-event).
No report copy table or replay-derived current state was added. The query strategy
still needs query-plan and workload evaluation before a product build.

The first reconnect test counted an active-state resubmission as another execution.
The corrected test inspects the double's execution seam. This was a test-oracle bug,
not a request replay or Asset re-execution.

### Limits that remain visible

At the 65-Task design boundary the double retains the 65th Task before its queue
report validation throws. This partial mutation is a spike limitation, separately
from the incompatible documented contracts. No silent truncation or invented
Protocol chunking hides the failure. See [Asset notes, Confirmed design problem](asset/NOTES.md#confirmed-design-problem-aggregate-queue-cannot-always-be-reported).

Credential responses remain recoverable in the idempotency cache as described
above. Route refusals are cached with their caller and retry key after rolling back
route mutations. Compatibility, authentication and malformed transport failures
before a validated caller/key/body are not cached. See [Core API, Basics](../core/docs/api.md#basics).

The double has an explicitly driven clock, equipment observations and heartbeat
scheduler. Diagnostics/reports are held in process memory. There is no SITL,
MAVLink driver, physical motion, hardware test, flight-controller crash/hang test,
archive export, service lifecycle, module-startup cleanup, sensor-overflow test,
or production log rotation/debug service. Local failsafe IDs/policy evidence stay
in diagnostics where current Protocol cannot express them. These limits follow
[Asset testing, ArduPilot SITL and simulated equipment](../asset/docs/testing.md#ardupilot-sitl-and-simulated-equipment)
and [Asset failsafes, Open](../asset/docs/failsafes.md#open); a simulated outcome
establishes no real flight outcome.

## Inefficiencies to investigate, not confirmed design defects

[Core API, The event log and live stream](../core/docs/api.md#the-event-log-and-live-stream)
correctly allows a slow reader to resume from disk. This spike polls SQLite for each
reader every 20 ms. Poll cost and repeated window queries can dominate at larger
history sizes. These are implementation choices, not requirements of the documented
system. No measured speedup, regression, or product design defect is claimed.

[Asset behavior, Record and send report history](../asset/docs/README.md#record-and-send-report-history)
and [Core API, Not defined yet](../core/docs/api.md#not-defined-yet) explicitly defer
catch-up pacing. The spike uses small retained batches and leaves fairness,
bounded retention and a complete-history indicator unproven. Resolve the open
contract before interpreting a high-rate history replay as intended live behavior.
