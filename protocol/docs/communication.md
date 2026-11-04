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
   Core's own `seq`.
4. From then on Core forwards each new report as it arrives: telemetry, status,
   queue changes and failsafes.
5. To act, the interface sends `control.command`, `control.settings` or `control.cancel`
   with `asset_id`. Core checks it against that Asset's hello (and its settings report)
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
  `asset_id`, `operator_id`, or Core) and its **`seq`**.
- Everything a sender sends gets a new `seq`. Core puts its own `seq` on every report it
  forwards or repeats, so on any link the sender is the other end of that link.
- A sender's `seq` is one counter across all its links. It does not reset on reconnect;
  it restarts at 0 only when the sender itself restarts.
- The receiver remembers, per sender, the `seq` values it has handled (at least the last
  1024). A message whose `(sender, seq)` it has already handled is dropped: not acted on,
  not stored, not replied to.
- An unseen `seq` is handled even if it arrives late or out of order.
- A hello whose `seq` is below the highest remembered means the sender restarted:
  the receiver forgets that sender's `seq` values, then handles the hello.

## Push, and asking

- Core **pushes** tasks and settings to an Asset when they change.
- An Asset may also **ask**, for example "send me my tasks" after reconnecting.
  Core answers with the same push messages.
- Both directions use the same messages. There is no separate request/response format.

## Delivering a task queue

Sending a whole queue at once could fail on a slow link. Instead:

1. Core sends **each task as its own message** (a `control.command` or `control.settings` with a `task_id`).
2. The Asset reports its **queue**: the list of task IDs it holds, in order.
3. Core resends any task missing from that list. Either side can ask for the queue at any time with `query.queue`, for example an Asset after reconnecting.
4. Each task carries `task_seq`, its place in the queue (1, 2, 3, ...). The Asset runs tasks in that order. If it holds 1 and 3, it finishes 1, then waits at the gap for 2, up to 10 s. If 2 has not come, it sends `query.queue` and keeps waiting; Core resends 2.
5. A task whose `task_id` the Asset already holds is ignored, so a resend is harmless.

## Immediate commands and cancel

- A motion command without `task_id` (takeoff, move_to, land, return_to_home) runs now and **cancels the rest of the queue**. The Asset reports each cancelled task (`report.status` kind `task`, `cancelled`) and then its empty queue.
- A `control.settings` without `task_id` runs now beside the queue and does not cancel it.
- `control.cancel` stops a command partway, for example a landing. With `task_id` it cancels that task; without, it stops the motion running now. The Asset then holds (hovers, or stays on the ground), sets `run_state` paused, reports the task cancelled, and sends `report.settings` with `reply_to` the cancel's `seq`. Core resumes it with `run_state: running` or sends a new command.

## Losing the link

Each failsafe trigger has its own response setting. With `link_loss_response: continue` the Asset keeps its mission while out of contact (for example Core in a car going through a tunnel). When the link returns it says hello, sends its queue, and Core and the Asset resync with `query.queue`.

## Task states

`queued`, `active`, `completed`, `failed`, `cancelled`.
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
