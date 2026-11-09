# SDK logging

The SDK is a library, so it keeps no log of its own. It hands diagnostic events
to an optional observer, and the host collects them with its own logs. Core does
not use the SDK; [Asset logging](../../asset/docs/logging.md) collects them on an Asset.

## What it reports

The SDK reports every step, not only errors:

- Requests: each attempt, its status, retries with their key, `unknown` results,
  and validation failures with their paths.
- The definitions check and any mismatch, with both hashes.
- The event stream: opens, closes, keepalives, idle timeouts, reconnect delays,
  `401`, and the cursor after each handled event.
- The Asset helpers: batches sent, resent and acknowledged; lists applied or
  ignored; Tasks handed to the app, finished, cancelled or cleared.

Each event has a `name`, a local millisecond `at`, a local counter, and its detail.
These are local diagnostics, not Protocol records.

## Rules

- The SDK never logs credentials. It removes passwords, keys, keys that Core
  returns once, and `Authorization` headers before an event reaches the observer.
- **Observer errors never break requests.** The SDK calls the observer through
  `queueMicrotask`, catches what it throws, and attaches a handler to any promise
  it returns without awaiting it. The SDK does not report an observer failure to
  that same observer.
- **Gaps are visible.** If the SDK drops events, it counts them and reports the count.
