# Asset

The SDK gives an Asset a startup sequence on IP, a report outbox, and a
Task queue helper. The rules they follow are in
[Asset and gateway calls](../../core/docs/api.md#asset-and-gateway-calls). Helpers
never fly. The [Asset app](../../asset/docs/README.md) runs each Task, applies
settings, and owns its failsafes.

## The Asset link

The outbox and the queue helper do not call HTTP themselves. They use a small
Asset link:

```ts
interface AssetLink {
  events(after?: number): AsyncIterable<Event>;  // this Asset's requests, in event_id order
  sendReports(reports: Report[]): Promise<void>; // resolves once the batch is acknowledged
  onContact(cb: (contact: Contact) => void): () => void;
}
```

On IP, the SDK client provides it. On a radio Asset, the Fieldlink provides it.
The Asset app's code is the same on both.

## Startup on IP

`startAsset(atlas, { description, settings, queue })` follows the sequence in
[Asset and gateway calls](../../core/docs/api.md#asset-and-gateway-calls) on every
start and reconnect:

1. `connect()`, which compares the definitions hash.
2. Send the description.
3. Send one report batch with the known settings, the queue report if the queue
   helper holds a list, and every final Task report not yet acknowledged.
4. Follow `/events` after the last handled `event_id`, or from the latest event on
   first start.

A refused step stops startup and returns that result. If a step gets no response,
the SDK retries it with the same key until Core answers. Later steps wait for it.

## Report outbox

The app hands reports to the outbox, which sends them in batches with
`POST /assets/{asset_id}/reports`.

- Each batch gets one `Idempotency-Key` when it is formed. The outbox resends that
  same batch with the same key until it gets a `200`, then drops it.
- Reports added while a batch is in flight go into the next batch, so a resent
  batch never changes.
- Final Task reports (`completed`, `failed`, `cancelled`) stay in the outbox until
  acknowledged, across reconnects. Other reports keep their original times when
  sent after a gap. Which of them to keep during a gap is the
  [Asset's choice](../../asset/docs/communications.md#report-from-local-state).
- A report answering a request carries `request_id`, the request's `event_id`.

## The queue helper

The queue helper is optional. A reporting-only Asset with no queue does not use
it. The helper holds the current list and hands Tasks to the app.

- **Holds the list.** It keeps the current `queue_version` and the ordered Task
  bodies, plus every `task_id` it has started this run.
- **Applies a new list only when it fits.** A `queue.requested` takes effect only
  when its `queue_version` is the helper's current one, unless `now` is set. The
  list arrives whole, so it takes effect at once. The helper raises its
  `queue_version` and sends a queue report with the request's `request_id`.
- **Reports what it drops.** Tasks that leave the list without starting are
  reported `cancelled`. Tasks of an ignored list that it never held are reported
  `cancelled` too, and the queue report shows the list still in effect.
- **Never runs a `task_id` twice.** A list that names a started or finished Task
  does not run it again.
- **The app pulls work.** The app calls `next()` when it is ready to run a Task,
  so pause, equipment checks and failsafes stay in the app. With `now`, the helper
  tells the app to end the running Task and run the new one at once, even while paused.
- **Cancel names one Task.** A queued Task is removed and reported `cancelled`. A
  running Task is handed to the app to stop; the app reports it. Either report
  carries the cancel's `request_id`.
- **Finishing.** The app calls `finish(task_id, state, fields)`. The helper builds
  the final `report.status` Task report and hands it to the outbox.
- **Clearing.** `clear()` reports every listed Task `cancelled` and raises
  `queue_version`. The app calls it when a command fails or a failsafe starts, as
  in [failsafes](../../asset/docs/failsafes.md#a-failed-command-cancels-the-remaining-tasks).

Settings requests are not Tasks unless they arrive as one. The helper passes
`settings.requested` events to the app in event order; the app applies them and
sends `report.settings` with the request's `request_id`.

State is in memory for the run. Recovery after a process restart is not designed.

## On a radio Asset

A radio Asset runs the same Asset app, outbox and queue helper. Its Fieldlink
implements the [Asset link](#the-asset-link). It delivers each request with its
`event_id` and delivers a queue whole even if the gateway split it on the radio.
It resolves `sendReports` on end-to-end acknowledgement and supplies contact. The
Fieldlink owns its own startup and the hash check on its link. Fieldlinks are not
part of the SDK.
