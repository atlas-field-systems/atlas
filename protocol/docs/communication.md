# How Atlas parts communicate

> **Draft proposal for developer review.** Nothing here is decided until the developer approves it.

## One model for every link

Every link is a **two-way message stream**, like a chat. Either side sends a
message whenever it has something to say. Nothing has to wait for a reply.

- Over IP (Core, gateways, apps), the stream is a **WebSocket**.
- Over radio, the stream is the **mesh link**.
- The **gateway bridges** the two. It passes the same protocol messages along
  and does the routing (see [Routing and duplicates](#routing-and-duplicates)).
  Packaging and compression may differ per link; the messages do not.

Details that belong to one medium (size limits, chunking, compression, timing)
live in a **link profile** for that medium, not in the messages.

## Opening a connection

1. The WebSocket (or radio link) opens.
2. The first message on the link is `admin.hello`: `asset_id`, its 16-byte asset key
   (and the enrollment key the first time), protocol version, the reports it sends,
   the commands it accepts, and its cameras. See [Storage](storage.md#registration).
   Keys appear in no other message, and Core never sends one.
3. A version mismatch gets `version_mismatch` ("update this device"); a bad key gets
   `refused`. Either way Core closes the link. Anything sent before an accepted hello
   closes the link too. After the hello, no message carries a version.
4. If the Asset already has a link open, the newer link replaces the older; Core closes the older.

## Operator interfaces

An operator interface (a map, a console, a script) is just another link: **one
WebSocket per interface**, the same messages, pushed both ways, no polling.
No user accounts or roles.

1. The WebSocket opens and the interface's first message is `admin.operator_hello`:
   its `operator_id`, its 16-byte key and protocol version. Core checks the key like an
   asset key (it stores only the hash) and answers `admin.hello_reply` with `operator_id`.
2. Each interface has its own `operator_id`. A newer link with the same ID replaces
   the older; Core closes the older.
3. Core pushes every Asset's latest hello as `admin.asset` (the asset list: the hello without its keys) and each Asset's
   latest reports (settings, status, queue, telemetry, battery), unchanged except for
   Core's own `seq`. For settings, that is each report holding a setting's newest value,
   oldest first (see [Settings](#settings)).
4. From then on Core forwards each new report as it arrives: telemetry, status,
   queue changes and failsafes.
5. To act, the interface sends `control.command`, `control.settings` or `control.cancel`
   with `asset_id`. Core checks it against that Asset's hello (and its connect settings report)
   and passes it on with Core's own `seq`, or refuses it with a reason. A command to an
   Asset that is not connected is refused; Core does not hold it.
6. To read, it uses `query.core` and `query.asset`; `every_s` repeats an answer, each
   repeat with a new `seq`. Core sends a query's answer first and its `admin.reply` last,
   so the reply marks the end; an accepted reply alone means nothing matched.
7. Core answers **every** operator message after the hello with one `admin.reply`:
   `accepted` or `refused` (with `explanation`), `reply_to` its `seq`. Accepted only means
   Core passed it on. The Asset's own reports (task status, queue, `report.settings`)
   confirm the effect, and reach the interface like any other report.

## Routing and duplicates

**Routing is the link's job, not the protocol's.** A gateway, mesh or radio picks the
path and may send a message over more than one. Messages carry no route, hop or
gateway fields, and Core reaches an Asset through whichever link it is on.

So a message can arrive twice. Every receiver, Core included, applies one rule:

- A message is identified by its **sender** (the ID checked in its opening hello:
  `asset_id`, `operator_id`, or Core), its **`seq`** and its **`time`**.
- A **retry** is the same message sent again, unchanged: same `seq`, same `time`.
  Everything else a sender sends gets a new `seq`. Core puts its own `seq` on every report
  it forwards or repeats, so on any link the sender is the other end of that link.
- A sender's `seq` is one counter across all its links. It does not reset on reconnect.
  An Asset or operator interface may restart it at 0 when it restarts; its `time` keeps
  the new messages apart from the old ones. Core keeps its counter across restarts, so
  Core's `seq` never goes back.
- A sender's clock never goes backwards, even across a restart, and a sender sends
  nothing until its clock is set. Clocks need not match each other.
- The receiver remembers, per sender, the `(seq, time)` of each message it has handled
  (at least the last 1024). A message it has already handled is not acted on or stored
  again. If the receiver answered it (`admin.reply`, or `report.settings` with
  `reply_to`), it sends that same answer again, unchanged, so a sender that retries
  learns the outcome. Queries change nothing, so a repeated query is answered again.
- An unseen message is handled even if it arrives late or out of order.

## Push, and asking

- Core **pushes** tasks and settings to an Asset when they change. Assets never poll for work.
- An Asset may also **ask**, for example "send me my tasks" after reconnecting.
  Core answers with the same push messages.
- Both directions use the same messages. There is no separate request/response format.

## Delivering a task queue

Sending a whole queue at once could fail on a slow link. Instead:

1. Core sends **each task as its own message** (a `control.command` or `control.settings` with a `task_id`).
2. The Asset reports its **queue**: the list of task IDs it has not finished, the running one included, in order.
3. Core resends a task only while the Asset has never shown it holds it: never listed in a queue report, never reported on. Once the Asset has shown it, Core never sends it again. Either side can ask for the queue at any time with `query.queue`, for example an Asset after reconnecting.
4. Each task carries `task_seq`, its place in the queue (1, 2, 3, ...). The Asset runs tasks in that order. If it holds 1 and 3, it finishes 1, then waits at the gap for 2, up to 10 s. If 2 has not come, it sends `query.queue` and keeps waiting; Core resends 2.
5. An Asset never runs a `task_id` twice. A task it holds is ignored. For a task it has finished, it sends that task's final report again. It remembers at least its last 1024 finished `task_id`s.

### Final reports are acknowledged

When a task finishes (`completed`, `failed` or `cancelled`), the Asset keeps sending
that `report.status` as a retry, on each new link and every 10 s, until Core answers
it with `admin.reply` (`accepted`, `reply_to` the report's `seq`). A lost answer is
covered the same way: Core recognises the retry and sends its answer again.

A task the Asset has shown it holds that leaves its queue with no final report is
waiting for that report. If the Asset restarted and lost it, the outcome is unknown;
Core does not send the task again.

## Immediate commands and cancel

- A motion command without `task_id` (takeoff, move_to, land, return_to_home) runs now and **cancels the rest of the queue**. The Asset reports each cancelled task (`report.status` kind `task`, `cancelled`) and then its empty queue.
- A `control.settings` without `task_id` runs now beside the queue and does not cancel it.
- `control.cancel` stops a command partway, for example a landing. It never creates a task.
  - Core passes on a cancel with `task_id` only for a task that has not finished. It refuses an unknown `task_id` ("A1 has no task T9") and a finished one ("T3 is already completed").
  - With `task_id` for a queued task, that task is dropped and the running one carries on. With `task_id` for the active task, or without `task_id`, the motion running now stops.
  - When the Asset stops motion, it holds (hovers, or stays on the ground) and sets `run_state` paused. Core resumes it with `run_state: running` or sends a new command.
  - The Asset reports the task cancelled, then its queue. It answers every cancel with `report.settings`, `reply_to` the cancel's `seq`.
  - For a task it has already finished, the Asset changes nothing and sends that task's final report again. For a task it has not received yet, it remembers the `task_id` as cancelled, reports it cancelled, and never runs it.

## Settings

- After each accepted hello the Asset sends its **connect report**: a `report.settings`
  with every setting it supports and its value. Core refuses changes to any setting the
  latest connect report left out, and the Asset never reports one until its next hello.
- A later `report.settings` may carry only some settings. A setting left out is
  unchanged, not unsupported.
- Per setting, the newest `time` wins; on equal times, the higher `seq`. An older report
  is kept in history and changes nothing.

## Losing the link

An Asset is **in contact** with Core while it hears new messages from Core (not
duplicates) after its accepted hello. Nothing else counts: not an open socket, not a
radio acknowledgement, not hearing the gateway or other Assets.

- So silence means something, Core is never quiet for long. When it has sent an Asset
  nothing for a third of that Asset's `link_loss_after_s`, it sends `admin.alive`.
- The link is **lost** when the Asset has had no contact for `link_loss_after_s`
  (30 s unless set), timed on its own clock. A link that drops and comes back within
  that time is not lost.
- The `link_loss` failsafe then triggers once, with the Asset's `link_loss_response`.
  It can trigger again only after contact returns.
- With `continue` the Asset keeps its active task and its queue while out of contact
  (for example Core in a car going through a tunnel).
- When contact returns, the Asset says hello if the link reopened, sends the reports it
  held, then its queue, and Core and the Asset resync with `query.queue`.

## Task states

`queued`, `active`, `completed`, `failed`, `cancelled`.
A task's state only moves forward: queued, active, then one final state (completed,
failed or cancelled). The first final state stays. A report that would move a task
back, or from one final state to another, is kept in history and changes nothing;
Core does not forward it to operators.
When a task fails, or a failsafe triggers with any response except `continue`, the
Asset cancels the rest of the queue and reports each cancelled task and its empty queue.
Only reports from the Asset move a task forward. Core never assumes progress from
silence or position.

## Is an Asset reachable?

Its regular status reports are the proof. If it is silent longer than the link's
expected interval (set in the link profile), it is shown as stale.

## What goes on the stream

Everything except large files, such as object files. Large files use a separate
file transfer. Over IP, bandwidth efficiency does not matter for now. Link bandwidth
is a link-design concern, handled in each link profile, not in the messages.

## SDK

Keep these ideas from the old SDK and cut the rest:

- Commands are read from Protocol, never hardcoded.
- An Asset-side client.
- Recovery after reconnecting.
- Every send ends as one of: **accepted**, **rejected**, or **no answer yet**.

## Escape hatches

How this avoids locking Atlas in:

- **Messages are independent of the link.** A new radio or transport only needs a
  new link profile.
- **Link profiles are swappable.** Changing compression or chunking on one link
  touches nothing else.
- **No message assumes request/response.** Because everything is a one-way
  message on a stream, the same messages work over HTTP, a queue, or store-and-forward
  later if needed.
