# Core logging

Core needs detailed diagnostics from startup through Reset so a run can be
reconstructed from its archive. This is a requirement for the runtime, which is
not built yet.

## Keep diagnostics beside the event log

The [event log](api.md#the-event-log-and-live-stream) is the domain record: which
requests Core accepted and which reports it stored. A diagnostic log explains the
requests, refusals, decisions, and errors around it. Core keeps both. The
diagnostic record is append-only during a run, even when a request changes nothing.

There is no Protocol logging process and no API call for a log entry. Diagnostic
logs and local configuration are Core's own records, separate from Protocol's
shared domain records.

## Record the whole path through Core

- Startup, shutdown, resolved configuration with secrets removed, software and
  package versions, and logging setup failures.
- Logins, authentication decisions without credentials, event-stream connections
  and disconnections, and contact changes.
- Every API request and its response, including idempotent repeats, refusals,
  definitions mismatches, and validation failures with their paths.
- Business decisions with their reasons: accept or refuse a request, assign a
  `task_id`, build a queue, store a report, or keep an older report as history.
- The distinction between request acceptance and an observed Asset result.
- Storage operations, Fusion and Plugin activity when present, errors, and
  diagnostic records that could not be written.

Preserve Core's local arrival and send order independently of record times.
Correlate records with `event_id`, `task_id`, and `asset_id`; do not add
correlation fields to Protocol. Detail and destination controls are proposed in
[Core configuration](../config.md).

## Include the evidence in Reset

Core's archive contains its event log, its diagnostic files, configuration with
secrets removed, and the summary required by
[First flight](../../atlas/first-flight.md#keep-the-whole-run-for-debugging).
It contains only what Core observed; Asset and gateway archives remain separate
evidence.

Proposed procedure: finish and verify the archive before discarding any run
evidence. The Reset request, file layout, summary format, and subsequent cleanup
remain open. A failed export must not be described as a complete archive.

## Proposed recording policy

Use structured local records with a readable rendering. Full tracing includes
request and report content after credential redaction. The event log already
holds each accepted request and stored report; the diagnostic log adds the
decisions around them rather than a second copy. Configuration selects output
paths and limits, not changes to request handling.

Logging must not block request handling indefinitely or exhaust memory. Rotation,
backpressure, and full-disk behavior still need concrete choices. Any lost,
truncated, or filtered evidence must be visible in the archive; do not silently
claim a complete record.
