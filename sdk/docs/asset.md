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
2. Register with the description, as `requests.asset`, on start, which
   returns the `asset_id`; on reconnect, send the description record with it.
3. Send one report batch with the known settings, the queue report if the queue
   helper holds Tasks, the active Task's report, and every final Task report not
   yet acknowledged.
4. Follow `/events` after the last handled `event_id`, or from the latest event on
   first start.

A refused step stops startup and returns that result. If a step gets no response,
the SDK retries it with the same key until Core answers. Later steps wait for it.

## Report outbox

The app hands reports to the outbox, which sends them in batches with
`POST /entities/assets/{asset_id}/reports`.

- Each batch gets one `Idempotency-Key` when it is formed. The outbox resends that
  same batch with the same key until it gets a `200`, then drops it.
- Reports added while a batch is in flight go into the next batch, so a resent
  batch never changes.
- Final Task reports (`completed`, `failed`, `cancelled`) stay in the outbox until
  acknowledged, across reconnects. Other reports keep their original times when
  sent after a gap. Which of them to keep during a gap is the
  [Asset's choice](../../asset/docs/communications.md#report-from-local-state).
- A report answering a request carries `request_id`, the request's `event_id`.
- With nothing to send, the outbox posts an empty batch every `heartbeatMs`
  ([configuration](../config.md)), so Core keeps the Asset
  [online](../../core/docs/api.md#contact).

## The queue helper

The queue helper is optional. A reporting-only Asset with no queue does not use
it. The helper holds the Asset's Tasks and hands them to the app.

- **Holds the Tasks.** It keeps every Task it has received and not started, its
  `clear_count`, and every `task_id` that has started or ended this run.
- **Orders by `task_id`.** Tasks may arrive in any order and more than once. The
  helper hands out the lowest held Task, and only when every lower `task_id` has
  ended and every Task through that Task's `send_last` is held or has ended.
- **Refuses stale Tasks.** It reports a Task `cancelled` when the Task's
  `clear_count` is not the helper's own, unless `now` is set.
- **Answers each request.** It sends a queue report with the `request_id` of each
  `tasks.requested`, listing the Tasks it holds.
- **Never runs a `task_id` twice.** A repeated Task changes nothing.
- **Applies place updates.** A `tasks.updated` event replaces the body of each
  held Task it names and hands an updated running Task to the app; it changes
  nothing for a Task that has ended. The helper answers it with a queue report
  carrying its `request_id`
  ([geo features](../../core/docs/api.md#geo-features)).
- **The app pulls work.** The app calls `next()` when it is ready to run a Task,
  so pause, equipment checks and failsafes stay in the app. With `now`, the helper
  cancels every lower `task_id` and tells the app to end the running Task and run
  the new one at once, even while paused.
- **Cancel names one Task.** A queued Task is removed and reported `cancelled`. A
  running Task is handed to the app to stop; the app reports it. A cancel for a
  Task that has not arrived is kept, and the Task is reported `cancelled` without
  running. Each report carries the cancel's `request_id`.
- **Finishing.** The app calls `finish(task_id, state, fields)`. The helper builds
  the final `report.status` Task report and hands it to the outbox.
- **Clearing.** `clear()` reports every held Task `cancelled` and raises
  `clear_count`. The app calls it when a command fails or a failsafe starts, as
  in [failsafes](../../asset/docs/failsafes.md#a-failed-command-cancels-the-remaining-tasks).

Settings requests are not Tasks unless they arrive as one. The helper passes
`settings.requested` events to the app in event order; the app applies them and
sends `report.settings` with the request's `request_id`.

State is in memory for the run. Recovery after a process restart is not designed.

## On a radio Asset

A radio Asset runs the same Asset app, outbox and queue helper. Its Fieldlink
implements the [Asset link](#the-asset-link). It delivers each request with its
`event_id`. It may deliver a request's Tasks one at a time and in any order,
because the queue helper orders them by `task_id`.
It resolves `sendReports` on end-to-end acknowledgement and supplies contact. The
Fieldlink owns its own startup and the hash check on its link. Fieldlinks are not
part of the SDK.
