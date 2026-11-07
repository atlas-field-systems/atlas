# Task queue

The Asset-side helper that holds an Asset's Tasks, runs them once each in Core's
order, and keeps resending final reports until Core acknowledges them. The wire
rules are [Delivering a task queue](../../protocol/docs/communication.md#delivering-a-task-queue)
and [Immediate commands and cancel](../../protocol/docs/communication.md#immediate-commands-and-cancel).
Helpers never fly: the Asset app runs each Task.

## Module: `asset-queue.mjs` (D6)

```js
export function createAssetQueue(opts: { link, identity, store?: TaskStore, now?, finalRetryMs?: number /*10000*/ }): AssetQueue
AssetQueue = {
  onTask(cb: (task: Message) => void): () => void  // emits in Core's order, at most once per task_id
  onImmediate(cb: (msg: Message) => void): () => void // immediate command/settings; control.cancel without task_id (stop motion now) and cancel of the running task
  next(): Message | null                           // head of list the Asset should run
  report(taskId, state: task_state, fields?)       // builds report.status kind task; finals kept for retry
  answer(request: Message, settings): Message      // builds report.settings with reply_from/reply_to; kept for replay
  queueReport(): Message                           // builds report.status kind queue with current task_ids
  clear(): void                                    // cancels every held task (each reported cancelled, then an empty queue report)
  ids(): string[]
}

TaskStore = Map-like { get(key), set(key, value), delete(key), keys() }  // default: new Map()
//   "task:<task_id>"          -> { final: Uint8Array, acked: boolean }  one record per finished task
//   "answer:<from:seq:time>"  -> Uint8Array                             the Asset's report.settings answer
// keys() is in insertion order; the helper keeps the newest >= 1024 of each prefix and deletes older ones.
```
A persistent store is anything with those four methods. All queue logic stays in
the helper.
Invariants (law 18, communication.md):
- A task is any `control.command` **or** `control.settings` carrying `task_id`.
- The order is arrival order of task bodies. That is Core's order, because Core sends a task only after the Asset has shown it holds the one before (law 18). The helper **never** waits on gaps and has no `task_seq`.
- Resent body for a task it **holds** (queued or running): ignored.
- Resent body for a task it has **finished**: nothing changes, and it resends that task's stored `final` bytes.
- When a task fails, or a failsafe triggers with any response except `continue`, the app calls `clear()`, sets `run_state` paused and reports it in `report.settings` (the app owns `run_state`, as for a cancel). A task that arrives afterwards is held like any other and waits while paused.
- A **motion** `control.command` without `task_id` runs now and clears the list. Each cleared task gets reported `cancelled`, then an empty queue report. A `control.settings` without `task_id` runs now beside the queue and does **not** clear it.
- `control.cancel` with `task_id`: a queued task is dropped and reported cancelled; the running one is emitted to `onImmediate` (don't fly anything, concept 10); a finished one changes nothing and its final report is resent; an unknown one is finished at once as `cancelled` (built, stored and retried like any final), so its body, if it arrives later, is a finished task: the cancelled report is resent and it never runs. In every case the queue reports the new list, and the cancel is answered.
- `control.cancel` **without** `task_id` stops the motion running now and is emitted to `onImmediate` (hold/pause); it never creates a task. The cancel is answered like any other.
- Every `control.cancel` and `control.settings` is answered with `report.settings` (`reply_from`/`reply_to` naming it). The helper builds the answer frame through `answer()`; the app supplies the `settings` object. The answer bytes are stored; a duplicate request (via `onDuplicate`) gets the same bytes again, unchanged. This is Asset-side answer replay, not Core's last-answer cache.
- Final reports (`completed|failed|cancelled`) are stored as `task:<task_id>` with `acked: false` until an `admin.reply` matches by `reply_from/reply_to` **and** `task_id`. Retry the **same bytes** on each new link and every 10 s (`finalRetryMs`) until acked, with no attempt cap. Observer event `final_report_retry` on each retry. With a persistent store, retries continue after an Asset restart.
- There is no queue cap and no "reject a task": the protocol gives an Asset no way to refuse one, so Core would resend forever. (Open question if a bound is ever needed.)
- After adding tasks, send `queueReport()`.
