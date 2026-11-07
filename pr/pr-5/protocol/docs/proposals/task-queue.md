# Proposal: the Asset carries its whole task list

**Status: proposal, not adopted.** Nothing here changes the spec until the owner
decides. If it is adopted, its rules move into [Communication](../communication.md),
the [laws](../laws.md) and the SDK's [Task queue](../../../sdk/docs/task-queue.md), and
this page is deleted.

## The problem

Today the queue lives in two places. Core keeps the ordered list and hands Tasks to
the Asset one at a time, each only after the Asset shows it holds the one before.
So the Asset never has the whole mission on board, and every rule that keeps the
two halves in step is a patch:

- Core guesses the queue was cleared from a cancel it did not send.
- A failure pauses the Asset only so late Tasks do not start.
- Core cancels Tasks still on their way after an immediate command, so the Asset
  must remember cancels for Tasks it has not received.
- `undelivered`, the one Task state Core sets, for work stranded in Core.
- A 12-Task mission takes 12 round trips to load. On LoRa that is slow, and if the
  link drops partway, the Asset flies off with only part of the mission.

## Goals

1. **The whole list is always on board.** The Asset never waits to fetch the next
   Task. It leaves with everything it was given and keeps it current.
2. **Light on slow links.** No resending the whole queue for every change.
3. **One owner.** The Asset owns its queue. Core delivers and records.
4. **Fewer rules.** Delete the patches above instead of adding new ones.

## How it works

Two kinds of message, split so neither is heavy:

- **Task bodies**: what each Task is. A `control.command` or `control.settings`
  with `task_id`, as today. Sent once each, all at once, as soon as the operator
  adds them. Arrival order does not matter.
- **The task list**: the order. A new `control.queue` holding only `task_id`s, plus
  the `queue_version` it was built on. A new list replaces the old one, like
  settings. Twelve Tasks is about 70 bytes before compression.

```json
{"type":"control.queue","time":1793667600000,"seq":12,"from":"OP1","asset_id":"A1","queue_version":3,"task_ids":["T1","T2","T3"]}
```

The Asset answers with its queue report (`report.status` kind `queue`), which gains
two fields: its `queue_version`, and `missing_task_ids`, the Tasks a waiting list
names whose bodies it does not have yet.

```json
{"type":"report.status","time":1793667600900,"seq":40,"from":"A1","asset_id":"A1","kind":"queue","queue_version":4,"task_ids":["T1","T2","T3"],"missing_task_ids":[]}
```

### A list takes effect only when it is complete

This is the rule that keeps the whole mission on board.

- The Asset switches to a new list only once it holds the body of every Task in it.
  Until then it keeps running its current list, which is already complete, and
  reports the missing ones.
- Core resends exactly the bodies named in `missing_task_ids`, at once. When the last
  one arrives, the Asset switches to the new list and reports it.
- So the list the Asset runs is always fully on board. If the link dies in the
  middle of an update, the Asset carries on with the last complete list instead of
  half of a new one.
- The operator sees "12 of 12 on board" before takeoff, and it stays true in flight.

### The version stops stale lists

- The Asset owns `queue_version` and raises it by one whenever its list changes: a
  new list takes effect, or the Asset clears the list itself.
- A list names the version it was built on. If that is not the Asset's current
  version, the Asset ignores it and reports its current list. The operator
  interface rebuilds the list from that and sends it again.
- Starting a Task does not raise the version. The list holds only Tasks not started
  yet, and the Asset skips any `task_id` it has already started or finished. So
  Tasks finishing in flight never cause a list to be refused.
- The Asset keeps its list, version and finished `task_id`s across a restart, so a
  version is never reused.

### Running, cancelling and clearing

- The Asset runs its list top to bottom while `run_state` is `running`.
- **Remove or reorder queued Tasks:** send a new list. A queued Task never needs
  its own cancel.
- **Stop the Task running now:** `control.cancel`, as today. The Asset holds and
  pauses.
- **Clears:** an immediate motion command (no `task_id`), a failed Task, or a failsafe
  with any response except `continue` clears the list and raises the version. Each
  cleared Task is reported `cancelled`. Any list built before the clear is now stale
  and is ignored, so old work can never restart. No pause is needed to guard against
  late Tasks.
- Bodies the Asset holds that no list names are kept, up to a limit, until the next
  clear.

### What Core does

- Passes bodies and lists on at once, unchanged, after its usual checks (online,
  command supported, `task_id` not used before in the run).
- Resends whatever bodies the Asset reports missing. That is Core's whole delivery
  job.
- Records the bodies and the Asset's latest queue report. Core does not own the order.
- When the Asset comes back after going offline, its queue report says what is
  missing and Core resends it. There is no `undelivered` state.

The operator interface writes the list, as it already picks `task_id`s. With two
interfaces open, the version check makes the second one rebuild instead of
overwriting the first.

## Cost on slow links

| | Today | Proposed |
| --- | --- | --- |
| Load a 12-Task mission | 12 bodies, sent one per round trip | 12 bodies back to back, 1 list: about 1 round trip |
| Add one Task | 1 body, 1 queue report back | 1 body, 1 list (IDs only), 1 queue report back |
| Remove or reorder a Task | 1 cancel per Task, plus reports | 1 list (IDs only), 1 queue report back |
| Lost body | Core waits for the Asset to show the one before | Named in `missing_task_ids`, resent at once |

Adding one Task costs one extra small message. Loading a mission is much faster,
because nothing waits on a round trip per Task.

## What it deletes and adds

Deletes:

- Core sending one Task at a time and waiting (part of law 18).
- Core inferring a clear from a cancel it did not send.
- Core cancelling Tasks still on their way after an immediate command.
- The Asset remembering cancels for Tasks it has not received.
- Pausing after a failure only to stop late Tasks.
- The `undelivered` state and "Core never carries work across a disconnect".
- `control.cancel` with a queued Task's `task_id`.
- The reconnect step where the Asset asks Core for its Tasks (`query.queue`); its
  queue report already says what is missing.

Adds:

- One message, `control.queue` (`queue_version`, `task_ids`).
- Two fields on the queue report: `queue_version` and `missing_task_ids`.
- One variable, `queue_version`.
- Two rules: a list takes effect only when complete, and a list for an old version
  is ignored.

## Open questions for the owner

1. **Names.** `control.queue`, `queue_version` and `missing_task_ids` are placeholders.
2. **List length.** The queue report already caps `task_ids` at 64. Keep 64 for the
   list too?
3. **Pause after a failure.** It is no longer needed for safety. Should a failed Task
   or failsafe still pause the Asset, or only clear the list?
4. **Old waiting lists.** A list waiting on bodies for a long time (a long outage)
   takes effect as soon as they arrive. Should a waiting list expire? Not proposed
   unless a real case needs it.
