# Core logging

Core needs detailed diagnostics from startup through Reset so a run can be
reconstructed from its archive. This is a requirement for the future runtime;
the retained prototype's console output does not implement it.

## Keep diagnostics beside normal state

Normal state answers questions such as which Tasks completed and where an Asset
was. A diagnostic log explains the messages, retries, decisions, and errors that
produced that state. Core keeps both. The diagnostic record is append-only during
a run, even when a message changes no state.

Core collects its own events and the [SDK's events](../../sdk/docs/logging.md)
into its local run record. There is no Protocol logging process and no new wire
message for a log entry. Component logs and local configuration are implementation
records, separate from Protocol's shared domain-record formats.

## Record the whole path through Core

- Startup, shutdown, resolved configuration with secrets removed, software and
  package versions, and logging setup failures.
- Connections, authentication decisions without credentials, link replacement,
  contact loss, and reconnects.
- Incoming, outgoing, and forwarded messages, including each retry, duplicate,
  rejection, and invalid-message diagnostic from the SDK.
- Business decisions with their reasons: accept or refuse a request, select an
  Asset link, store a Task, apply a report, or retain an older report as history.
- Queue delivery, missing bodies, acknowledgements, cached-answer replay, and
  the distinction between request acceptance and an observed Asset result.
- State-store and Object operations, fusion and Plugin activity when present,
  errors, and diagnostic records that could not be written.

Preserve Core's local message arrival and send order independently of message
timestamps. Correlate records with existing message identities and Task or Asset
IDs; do not add correlation fields to Protocol. Detail and destination controls
are proposed in [Core configuration](../config.md).

## Include the evidence in Reset

Core's archive contains its diagnostic files, SDK events, configuration with
secrets removed, and the domain histories and summary required by
[First flight](../../atlas/first-flight.md#keep-the-whole-run-for-debugging).
Core's archive contains only what Core observed; Asset and gateway archives
remain separate evidence.

Proposed procedure: finish and verify the archive before discarding any run
evidence. The Reset command, file layout, summary format, and subsequent cleanup
remain open. A failed export must not be described as a complete archive.

## Proposed recording policy

Use structured local records with a readable rendering. Full prototype tracing
includes message content after credential redaction. SDK message records provide
the transcript; Core adds decisions rather than a second copy of each SDK record.
Configuration selects output paths and limits, not changes to message handling.

Logging must not block message handling indefinitely or exhaust memory. Rotation,
backpressure, and full-disk behavior still need concrete choices. Any lost,
truncated, or filtered evidence must be visible in the archive; do not silently
claim a complete transcript.
