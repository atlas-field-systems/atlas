# Throwaway Asset double: scope and evidence

This code exercises selected behavior at `45bd026`. It is neither the Asset runtime nor flight validation. The developer must decide every proposed design change. No product doc is changed.

## What is exercised

`asset.test.ts` authors expectations from `asset/docs/README.md` headings **The queue**, **Tasks that run now**, **Cancel**, **Settings**, **Position and home**, and `asset/docs/failsafes.md` headings **A failed command cancels the remaining Tasks**, **A failsafe activates a configured Task**, **Lock ordinary work for the rest of the operation**, and **Configure conditions as well as responses**. Task/report records cross Protocol's existing validator; definitions are loaded as data. The double never generates tests from schemas or examples.

The double orders and deduplicates Tasks, gates a mission on `send_last`, treats prior cancellation as receipt, applies immediate settings in event order, bypasses pause for `now`, clears on observed failure, rejects old `clear_count`, retains an identical report batch/key through retries, keeps GPS measurement time, and keeps known home through link reconnect. Equipment completion is an explicit scenario input, never inferred from request acceptance. Ordinary movement and local failsafe responses both enter the `execute` equipment seam and log their separate outcomes. Missing equipment and unknown home fail execution rather than waiting.

Configured local policy supports contact-loss, battery, idle, airborne, equipment-fault, horizontal polygon, missing-position and stale-position conditions combined by AND and explicit priorities. Priorities only rise, responses/fallback run once, failsafe remains latched, only Land/Return `now` and pure run-state settings override it. An explicit observed autopilot takeover cancels ordinary work without inventing an Atlas maneuver. Reporting-only trackers invent no queue, home or settings.

`../client/client.ts` is a thin HTTPS client: verifies TLS using an optional supplied CA, carries the definitions hash and credentials, keeps an HttpOnly session cookie for tests, accepts explicit retry keys, and parses SSE incrementally with an AbortSignal. `reconnect` follows about → description → report → stream order; callers start `follow` and schedule heartbeat `flush` and `tick` explicitly. There is no autonomous background scheduler, UI, real SDK or Fieldlink.

## Confirmed design problem: aggregate queue cannot always be reported

`core/docs/api.md` **Operator requests** admits supported Tasks while online and sends every accepted request at once. It defines no aggregate queue capacity. `protocol/definitions/records/report/status/queue.json` (**queue**) bounds `task_ids` at 64. A paused Asset receiving 65 separate one-Task requests has 65 held Tasks but cannot send the required complete queue report.

Reproduce with `node --test spike/asset/asset.test.ts`, test **design probe: 65 held Tasks cannot be represented by Protocol queue report**. It uses the real validator and explicitly expects the 65th queue report to fail. Decide how admission, queue capacity and acknowledgment completeness fit together. A per-request batch bound alone does not resolve it. The probe is evidence of the mismatch, not proof of a selected fix.

The double also has a spike limitation at this boundary: it has already retained the 65th Task when report validation throws. It does not claim that partial receipt is conforming behavior or silently truncate the report.

## Doc conflict: recurring versus latched failsafe

`protocol/definitions/records/report/failsafe/link_loss.json` (**link_loss**, description) says the rule triggers again after contact returns. `asset/docs/failsafes.md` **A failsafe activates a configured Task** and **Lock ordinary work for the rest of the operation** say equal/lower-priority matches never start another response and state has no exit. The probe follows the Asset behavior and records this conflict explicitly. No product doc is quietly rewritten. The existing scalar `link_loss_response` and `low_battery_response` settings also cannot express the configured condition/priority policy; `protocol/docs/open-questions.md` already lists policy records as open.

## Provisional stand-ins and untested gaps

- Local policy objects, response IDs and autopilot takeover marker are local test controls, explicitly **provisional**, never submitted as invented Protocol records. Protocol has no general policy, local Task identity or override report. Response start/outcome and override evidence remain in diagnostics. Existing link-loss/battery failsafe reports use exact Protocol shapes; generic triggers cannot be represented on the wire yet.
- Core's supported-settings admission uses its explicit provisional configuration; the actual Protocol description is sent unchanged and cannot declare supported settings. Known values and supported capabilities are not conflated by the Asset.
- A simulated executor records requested actions and accepts supplied observations; it has no autopilot, MAVLink, ArduPilot SITL or physical dynamics. No flight-controller crash/hang or real protection has been tested. Equipment evidence, tolerances and independent takeover detection remain simulated inputs.
- Module startup/partial cleanup, configuration inspection/service installation, sensor overflow, archive export and shutdown acknowledgment timing are omitted. Their absence is spike coverage, not evidence of a product flaw.
- Local reports and diagnostics are retained in memory for the running double. A link reconnect preserves them; an Asset process restart deliberately does not recover them. Long disconnected report history is not bounded or paced. `asset/docs/README.md` **Open** and `asset/docs/logging.md` **Open** leave those policies unresolved.
- `stopped` records simulated safely-stopped shutdown. It does not model service lifecycle or wait for final-report delivery acknowledgment, whose policy is explicitly open in `asset/docs/failsafes.md` **Open**.

## Horizontal boundaries and measurement evidence

The explicitly provisional local policy supports `outside` with a polygon, horizontal `distanceM`, `afterMs`, and optional measurement `maxAgeMs`, plus separate `position_missing` and `position_stale` conditions. It evaluates an already-outside position without requiring a crossing. Zero distance/duration works. Unknown or stale position cannot establish outside; return inside or loss of evidence breaks the outside interval. The boundary counts as inside in this double. Local tangent-plane distances approximate small field polygons, with no claim for dateline, polar or large-area geography. `asset/docs/failsafes.md` **Open** leaves exact boundary/freshness details unresolved.

Policy replacement preserves idle, missing-position and outside elapsed timers for the same polygon, including when the configured duration or distance changes. Outside duration measures the interval outside the polygon, while distance is checked against the current evidence. Tests cover startup outside, zero thresholds, unknown/boundary evidence, independent distance/duration, policy replacement, return inside, freshness expiration and missing versus stale measurements. Generic trigger/outcome evidence remains local because Protocol cannot carry these policy/response records yet.
