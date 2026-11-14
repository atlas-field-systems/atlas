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
  sendReports(reports: Report[], priority: 'must_arrive' | 'can_skip'): Promise<void>;
                                                 // resolves once the batch is acknowledged
  onContact(cb: (contact: Contact) => void): () => void;
  capacity(): number | undefined;                // bytes per second the link can carry now, if known
  storeFile(file: AssetFile): Promise<string>;   // resolves with the object_id
}
```

The link carries messages and reports facts about itself; the Asset decides
everything else ([the boundary](../../fieldlink/README.md#the-fieldlink-moves-messages-the-asset-decides)).
The outbox marks a batch `must_arrive` when it holds a final Task report or
answers a request, and `can_skip` otherwise, and the link sends must-arrive
batches first. `capacity` tells the
[communications module](../../asset/docs/communications.md#report-from-local-state)
how much to send; on IP it is `undefined`.

`storeFile` [uploads a file the Asset captured](../../core/docs/api.md#objects).
`AssetFile` holds its `name`, `contentType`, bytes, and an optional `place`, a
`requests.geofeature` body. With a place, the link creates that geo feature
first and attaches the file to it. A link that cannot carry files, such as a
narrow radio link, rejects the call, and the file stays in the Asset's
[Reset ZIP](../../asset/docs/logging.md#export-the-assets-reset-zip).

On IP, the SDK client provides it. On a radio Asset, the Fieldlink's Asset side
provides it, and on a gateway-only Fieldlink the
[gateway interface](../../gateway/README.md#the-gateway-interface) does. The
Asset app's code is the same on all of them. Because Fieldlinks are released on
their own, this interface changes rarely, and each Fieldlink states which
versions it works with.

## Startup on IP

`startAsset(atlas, { description, settings, queue })` follows the sequence in
[Asset and gateway calls](../../core/docs/api.md#asset-and-gateway-calls) on every
start, and from step 3 on reconnect:

1. `connect()`, which compares the definitions hash.
2. Register with the description, as `requests.asset`, which returns the
   `asset_id` and startup cursor `as_of`. Only a start registers.
3. Send one report batch with the known settings, the queue report if the queue
   helper holds Tasks, the active Task's report, and every final Task report not
   yet acknowledged.
4. Follow `/events` after registration’s `as_of` on start. On reconnect, use
   the last handled `event_id`.

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

- **Holds the Tasks.** It keeps every Task it has received and not started, and
  every `task_id` that has started, ended, or been dropped this run. After a
  restart it counts every `task_id` up to the registration's `last_task_id` as
  ended.
- **Orders by `task_id`.** Tasks may arrive in any order and more than once. The
  helper hands out the lowest held Task, and only when every lower `task_id` has
  ended and every Task through that Task's `send_last` is held or has ended.
- **Refuses a full queue.** Holding 64 unstarted Tasks, it reports each
  further Task `cancelled`, unless `now` is set.
- **Skips dropped Tasks.** A `task.dropped` event counts its `task_id` as ended;
  a held Task it names is removed without running.
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
- **Clearing.** `clear()` reports every held Task `cancelled`. The app calls it when a command fails or a failsafe starts, as
  in [failsafes](../../asset/docs/failsafes.md#a-failed-command-cancels-the-remaining-tasks).

Settings requests are not Tasks unless they arrive as one. The helper passes
`settings.requested` events to the app in event order; the app applies them and
sends `report.settings` with the request's `request_id`.

State is in memory for the run. A restarted app holds no Tasks and starts again
from [registration](../../core/docs/api.md#operator-requests).

## On a radio Asset

A radio Asset runs the same Asset app, outbox and queue helper. Its Fieldlink
implements the [Asset link](#the-asset-link). It delivers each request with its
`event_id`. It may deliver a request's Tasks one at a time and in any order,
because the queue helper orders them by `task_id`.
It resolves `sendReports` on end-to-end acknowledgement and supplies contact. The
Fieldlink owns its own startup and the hash check on its link. Fieldlinks are not
part of the SDK.
