# SDK logging

The SDK is a library, so it keeps no log of its own. It hands diagnostic events
to an optional observer, and the host collects them with its own logs. Core does
not use the SDK; [Asset logging](../../asset/docs/logging.md) collects them on an Asset.

## What it reports

The SDK reports every step, not only errors:

- Requests: each attempt, its status, retries with their key, `unknown` results,
  and validation failures with their paths.
- The definitions check and any mismatch, with both hashes.
- The event stream: opens, closes, keepalives, open and idle timeouts, reconnect delays,
  `401`, and the cursor after each handled event.
  If Core does not answer the stream request in time, the SDK emits
  `stream.open_timeout`. An unexpected stream interruption includes the error.
  A deliberate stop closes the stream without reporting a failure.
- The Asset helpers: batches sent, resent and acknowledged; lists applied or
  ignored; Tasks handed to the app, finished, cancelled or cleared.

Each event has a `name`, a local millisecond `at`, a local counter, and its detail.
Each client shares one counter across its requests, link, outbox, and queue.
A host that supplies its own Asset link can call `diagnostics(clock, observer)`
and pass the returned emitter to `runAsset`. The host and Asset helpers then
share one counter. Keep credentials out of custom event detail.
Each batch resend produces one `batch.resent` event.
These are local diagnostics, not Protocol records.

The Asset helpers also offer `onReports`, separate from diagnostics. It receives
copies when reports enter the outbox and when current-state samples are offered.
The host can retain them even when diagnostics omit message content. A callback
failure emits `reports.recording_failed` and never prevents sending.

## Rules

- The SDK never logs credentials. It removes passwords, keys, keys that Core
  returns once, and `Authorization` headers before an event reaches the observer.
- **Observer errors never break requests.** The SDK calls the observer through
  `queueMicrotask`, catches what it throws, and attaches a handler to any promise
  it returns without awaiting it. The SDK does not report an observer failure to
  that same observer. It counts the undelivered events and includes the count
  in a later `diagnostics.gap` event.
- **Gaps are visible.** If the SDK drops events, it counts them and reports the count.
