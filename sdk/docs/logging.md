# SDK logging

The SDK exposes detailed diagnostic events to the program using it. Core and
Asset apps collect those events with their own logs. The SDK is a library, so
there is no separate SDK process, log-file rotation service, or Reset ZIP.

## Selected coverage

Diagnostics cover the full path through the SDK, not only errors:

- Link opening, hello progress, readiness, closes, reconnect attempts and delays,
  authentication loss, and changes in contact.
- Building, encoding, sending, forwarding, receiving, decoding, and validating
  messages. Each delivery attempt remains visible, including duplicates and
  messages dropped before the link is ready.
- Request registration, reply matching, query completion, late replies, timeouts,
  cancellations, and limits reached. Preserve `unknown` as uncertainty.
- Queue bodies and lists received, missing bodies, queue changes, immediate
  actions handed to the app, final reports, retries, and acknowledgements.
- Settings handed to the app and reports returned, without claiming that the
  SDK performed an equipment action.
- Diagnostic delivery failures or discarded events where detectable.

Protocol supplies the definitions used for validation; it is not a separate
runtime service to instrument. SDK events describe validation work and outcomes.
No diagnostic record needs a new Protocol message, field, or domain-storage table.

## Proposed event contents

Retain the observer's `name` and local millisecond `at`, and include the emitting
SDK instance and link context, a local event counter, severity, and reason where
applicable. Local ordering must not depend on comparing clocks across devices.

Message-related events include direction, message identity (`from`, `seq`,
`time`), type and kind, byte length, and relevant existing Asset, Task, and reply
references when available. Full tracing includes message content after credential
redaction. Validation failures include the useful error paths. Undecodable input
still has an event with its size and decode error; raw invalid-byte capture and
its redaction and size limits remain open.

These are local diagnostic fields, not additions to the shared message format.
Exact event names and record shapes remain a draft owned here.

## Deliver events through the host

Use the [observer](links.md#observer-optional) as the integration point. Its use
is optional for a general SDK caller; Core and Asset apps attach a diagnostic
consumer to meet their own logging requirements. A host chooses detail and
destination through [configuration](../config.md).

Observe messages at SDK boundaries so the host can retain the full transcript,
including invalid, duplicate, and pre-ready traffic. Logging sees retries even
when dedupe correctly suppresses another business effect. Forwarding remains
byte-preserving; logging must not mutate or restamp a message.

Observer errors do not fail message handling. Catch synchronous exceptions and
consume returned promise rejections without awaiting them, as required by the
[observer delivery rule](links.md#observer-optional).
A host consumer must enqueue promptly rather than perform blocking file I/O in
the callback. Bounded delivery, overflow accounting, filtering, and host output
failure reporting need final choices before implementation. Logging gaps must
be visible rather than hidden behind a claim of a complete run record.
