# Task queue

The Asset-side helper that holds an Asset's task list and Task bodies, runs each
Task once in list order, and keeps resending final reports until Core acknowledges
them. The wire rules are [Delivering a task queue](../../protocol/docs/communication.md#delivering-a-task-queue)
and [Immediate commands and cancel](../../protocol/docs/communication.md#immediate-commands-and-cancel).
Helpers never fly: the Asset app runs each Task. This helper is optional for
reporting-only Assets with no queue. They need no empty queue reports merely to
connect. A task-capable Asset coordinates execution through its configured
modules and equipment drivers.

## Module: `asset-queue.mjs` (D6)

```js
export function createAssetQueue(opts: { link, identity, now?, finalRetryMs?: number /*10000*/ }): AssetQueue
AssetQueue = {
  onTask(cb: (task: Message) => void): () => void  // emits in list order, at most once per task_id
  onImmediate(cb: (msg: Message) => void): () => void // immediate command/settings and control.cancel
  next(): Message | null                           // head of the list the Asset should run
  report(taskId, state: task_state, fields?)       // builds report.status kind task; finals kept for retry
  answer(request: Message, settings): Message      // builds report.settings with reply_from/reply_to; kept for replay
  queueReport(request?): Message                   // builds report.status kind queue; names request when it answers one
  clear(): void                                    // cancels every listed Task (each reported cancelled), raises queue_version, sends an empty queue report
  ids(): string[]
}

TaskStore = Map  // internal, in memory for the operation
//   "list"                    -> { version: number, ids: string[] }      the list in effect
//   "body:<task_id>"          -> Uint8Array                              a Task body it holds
//   "task:<task_id>"          -> { final: Uint8Array, acked: boolean }   one record per finished task
//   "answer:<from:seq:time>"  -> Uint8Array                              the Asset's answer to a request
// Finished tasks stay for the operation; answers stay paired with protected request identities.
```
All queue logic stays in the helper. Link reconnects use the same in-memory
state. Process restart recovery is outside the current design.
The [retention decision](identity-and-duplicates.md#module-identitymjs-and-dedupemjs-d7)
must be settled before implementing effectful dispatch and answer eviction.
The 1024-message minimum is not permission to forget a protected request's answer.
Invariants (law 18, communication.md):
- A body is any `control.command` **or** `control.settings` carrying `task_id`. It is stored; arrival order does not matter. A resent body for a Task it holds is ignored; for a Task it has finished, it resends that Task's stored `final` bytes.
- A `control.queue` built on a version other than the current `queue_version` is ignored, and answered with the current queue report.
- A `control.queue` takes effect only once every listed body is held, skipping `task_id`s already started or finished. Until then the current list keeps running and the queue report names the missing ones in `missing_task_ids`. A newer list replaces a waiting one. When it takes effect, `queue_version` goes up by one, each Task that left the list without starting is reported `cancelled`, and the queue report answers it.
- In ordinary operation, a **motion** `control.command` without `task_id` runs now and calls `clear()`. A `control.settings` without `task_id` runs now beside the list and does **not** clear it. When a failsafe activates, the app calls `clear()` before starting its locally created response Task. Bodies no list names are dropped at a clear.
- When a command fails, the app always clears the remaining queue before another
  Task can run, regardless of its configured safe response. A queued command's
  final report remains `failed`; clearing reports the remaining Tasks `cancelled`.
  The Asset owns [the failure behavior](../../asset/docs/failsafes.md).
- The app enforces [failsafe state](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation)
  before ordinary dispatch. Onboard Task creation and refusal reporting await
  [shared contracts](../../protocol/docs/open-questions.md#unresolved).
- `control.cancel` is emitted to `onImmediate` (hold/pause; don't fly anything, concept 10). It never creates a task.
- Every `control.cancel` and `control.settings` is answered with `report.settings` (`reply_from`/`reply_to` naming it). The helper builds the answer frame through `answer()`; the app supplies the `settings` object. Every answer's bytes, the queue report included, are stored; a duplicate request (via `onDuplicate`) gets the same bytes again, unchanged. This is Asset-side answer replay, not Core's last-answer cache.
- Immediate settings reach the app in receipt order. A settings Task applies when
  the app runs it from the list; neither path discards a change because another
  creator's request has a newer timestamp. The app reports its resulting values
  under [Protocol's settings rule](../../protocol/docs/communication.md#settings).
- Final reports (`completed|failed|cancelled`) are stored as `task:<task_id>` with `acked: false` until an `admin.reply` matches by `reply_from/reply_to` **and** `task_id`. Retry the **same bytes** on each new link and every 10 s (`finalRetryMs`) until acked, with no attempt cap. Observer event `final_report_retry` on each retry. The list, queue version, finished tasks and unacknowledged reports stay in memory through link disconnects.
- The list holds at most 64 `task_id`s (the definition's limit).
