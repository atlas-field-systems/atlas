# Core and SDK simulations

The first version of Simulations: Core and the SDK, with Protocol's
validator, running together under a faulty network. The
[Simulations README](../README.md) owns the shared rules.

## The simulated world

- **Core** runs as it ships, on a data directory the simulation creates, with a
  simulated clock. Crash and stop scenarios run it as its own process.
- **Every caller uses the SDK**: operators logged in to accounts, scripted
  [simulated Assets](../README.md#simulated-assets) on IP with Asset keys,
  scripted gateways carrying radio Assets with a gateway key, and scripted
  Plugins with Plugin keys.
- **The network** sits between each SDK client and Core. A scenario or a fault
  run can delay, lose, or repeat a request; lose a response after Core stored
  the change; drop an event stream; or cut a caller off for a while.

## Scenarios

Each checks rules the [Core API](../../core/docs/api.md) or the
[SDK](../../sdk/README.md) owns. Scenario lists that Core's pages already state,
[credential retries](../../core/docs/api.md#credential-retry-scenarios) and
[request admission](../../core/docs/requests.md), run here as written.

- **Lost responses.** Lose the response to every kind of change, from Tasks and
  settings to reports, geo features, Object uploads, and Plugin answers. The
  SDK retries with the same idempotency key, and the change happens once
  ([retries](../../core/docs/api.md#basics)). The same key with a different body
  is refused.
- **Dropped streams.** Drop a reader's event stream at random points, then let
  it reconnect. It handles every event once, in order, with none missing
  ([event stream](../../core/docs/api.md#the-event-log-and-live-stream),
  [SDK live](../../sdk/docs/live.md)). A snapshot followed by the stream after
  its `as_of` gives the same picture as the stream alone.
- **Tasks across the link.** Deliver a request's Tasks late, out of order, or
  twice. The queue helper runs them in `task_id` order, never starts one before
  the request is all held, and never runs a `task_id` twice
  ([queue helper](../../sdk/docs/asset.md#the-queue-helper)).
- **Going offline.** Cut an Asset off with Tasks, settings, and cancels
  unanswered. Core drops them, the Asset never runs a dropped Task when it
  returns, and later work is not blocked
  ([operator requests](../../core/docs/api.md#operator-requests),
  [contact](../../core/docs/api.md#contact)).
- **Restarts.** Restart a simulated Asset's app mid-run. It keeps its
  `asset_id`, its unfinished Tasks are dropped, and new work runs.
- **Wrong clocks.** An Asset whose clock runs ahead has its reports stored and
  marked, and never used as a latest value
  ([Asset calls](../../core/docs/api.md#asset-and-gateway-calls)).
- **Reports after a gap.** An Asset cut off for a while catches up in batches
  with original times, and history orders them by those times.
- **Gateways.** A gateway registers radios, reports their contact, and acts
  only for Assets it carries. When it goes quiet, it and every radio it carries
  show offline ([radio Assets](../../core/docs/api.md#radio-assets)).
- **Places in Tasks.** Edit a place that unfinished Tasks name, with and
  without updating them, while some of their Assets are offline
  ([geo features](../../core/docs/api.md#geo-features)).
- **Objects.** Uploads that are too large, deleted, or still shown by imagery
  are refused as the [Objects](../../core/docs/api.md#objects) rules say.
- **Plugins.** A Plugin goes offline with calls unanswered, and Core drops them;
  a second answer is refused ([Plugins](../../core/docs/api.md#plugins)).
- **A full disk.** Fill Core's disk mid-run. Core refuses changes with
  `507 storage_full` and stores nothing half-done
  ([storage](../../core/docs/storage.md#memory-and-full-disks)).
- **Crash and stop.** Kill Core mid-run and start it: the run resumes, with the
  same `run_id`. Stop it on purpose and start it: a new run, every caller drops
  what it held from the old one, and the Reset ZIP holds the old run
  ([Reset](../../core/docs/reset.md)).

## Rules every fault run checks

- A `task_id` never runs twice, and every Task ends in a final report or a drop.
- Every accepted request ends in the Asset's answer or a visible drop.
- Every reader handles each event once, in order.
- Every change Core accepted has its event, and every event has its change.
- A retried request never changes anything twice.
- No bearer key or session cookie can be read back from Core's stored state or logs.
