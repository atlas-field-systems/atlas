# How Atlas parts communicate

How every part of Atlas behaves on a link, for protocol 0.8. It spells out the
[laws](laws.md) in full. The SDK implements these rules; what it adds on top is in
[SDK how it works](../sdk/how-it-works.md).

## One model for every link

Every link is a **two-way message stream**, like a chat. Either side sends a
message whenever it has something to say. Nothing has to wait for a reply.

- Over IP (Core, gateways, apps), the stream is a **WebSocket**.
- Over radio, the stream is the **mesh link**.
- The **gateway bridges** the two. It passes the same protocol messages along
  and does the routing (see [Routing and duplicates](#routing-and-duplicates)).
  Packaging and compression may differ per link; the messages do not.

Details that belong to one medium (size limits, chunking, compression, timing)
live in a **link profile** for that medium, not in the messages. Transport
adapters only move bytes; framing and JSON stay in the SDK or link profile.

## Opening a connection (Asset)

1. The WebSocket (or radio link) opens.
2. The first message on the link is `admin.hello`: `asset_id`, `from` (the same
   id), protocol version, and its 16-byte asset key (and the enrollment key the
   first time). Keys appear in no other message, and Core never sends one.
3. A version mismatch gets `version_mismatch` ("update this device"); a bad key
   gets `refused`. Either way Core closes the link. Anything sent before an
   accepted hello closes the link too. After the hello, no message carries a
   version.
4. If the Asset already has a link open, the newer link replaces the older; Core
   closes the older.
5. After an accepted hello, the Asset sends `admin.describe` (reports, commands,
   cameras — no keys). Core stores it, acknowledges it with `admin.reply`, and will forward it unchanged to operators.

## Operator interfaces

An operator interface (a map, a console, a script) is just another link: **one
WebSocket per interface**, the same messages, pushed both ways, no polling.
No user accounts or roles.

1. The WebSocket opens and the interface's first message is `admin.operator_hello`:
   its `operator_id` (also `from`), its 16-byte key and protocol version. Core
   checks the key like an asset key (it stores only the hash) and answers
   `admin.hello_reply` with `operator_id`.
2. Each interface has its own `operator_id`. A newer link with the same ID replaces
   the older; Core closes the older.
3. Core pushes every Asset's latest `admin.describe` and each Asset's latest
   reports (settings, status, queue, telemetry, battery), **unchanged** (same
   `from`, `seq` and `time`). For settings, that is each report holding a
   setting's newest value, oldest first (see [Settings](#settings)).
4. From then on Core forwards each new report as it arrives: telemetry, status,
   queue changes and failsafes — still unchanged.
5. To act, the interface sends `control.command`, `control.settings` or
   `control.cancel` with `asset_id` and its own `from`/`seq`. Core checks it
   against that Asset's describe (and its connect settings report) and passes it
   on **unchanged**, or refuses it with a reason. Anything sent to an Asset that
   is [offline](#when-core-counts-an-asset-offline) is refused; Core does not hold it.
6. To read, it uses `query.core` and `query.asset`; `every_s` repeats an answer
   as a **new** message (new `seq` from its creator). Core sends a query's answer
   first and its `admin.reply` last, so the reply marks the end; an accepted
   reply alone means nothing matched. Live forwards keep flowing meanwhile; the
   reader takes as the answer the messages that match the query's own fields.
7. Core answers **every** operator message after the hello with one `admin.reply`:
   `accepted` or `refused` (with `explanation`), `reply_from` + `reply_to` naming
   the operator message's (`from`, `seq`). Accepted only means Core passed it on.
   The Asset's own reports (task status, queue, `report.settings`) confirm the
   effect, and reach the interface like any other report.

## Routing and duplicates

**Routing is the link's job, not the protocol's.** A gateway, mesh or radio picks the
path and may send a message over more than one. Messages carry no route, hop or
gateway fields, and Core reaches an Asset through whichever link it is on.

So a message can arrive twice. Every receiver, Core included, applies one rule:

- A message is identified by its **`from`** (the creator), its **`seq`** and its
  **`time`**.
- A **retry** is the same message sent again, unchanged: same `from`, same `seq`,
  same `time`. Everything else a creator sends gets a new `seq`.
- Core **forwards other creators' messages unchanged**. It does not stamp a new
  `seq` on them.
- A creator's `seq` is one counter across all its links. It does not reset on
  reconnect. An Asset or operator interface may restart it at 0 when it restarts;
  its `time` keeps the new messages apart from the old ones. Core keeps its own
  counter across restarts for messages it creates (`from` is `CORE`).
- A creator's clock never goes backwards, even across a restart, and a creator
  sends nothing until its clock is set. Clocks need not match each other.
- The receiver remembers, per `from`, the `(seq, time)` of each message it has
  handled (at least the last 1024). A message it has already handled is not
  **acted on** again: no task runs twice, no setting is applied twice, nothing is
  stored twice. Acting and delivering are separate. A replayed message (a
  `query.core` answer, Core's connect push after a reconnect) is still
  **delivered** to the reader that asked for it or is watching: a stream, a
  subscriber, a live picture. A picture upserts by `(from, seq, time)`; when it
  replaces a value, the newest `time` wins. If the receiver answered it (`admin.reply`, or
  `report.settings` with `reply_from`/`reply_to`), it sends that same answer
  again, unchanged, so a sender that retries learns the outcome. Queries change
  nothing, so a repeated query is answered again (Core's last-answer cache).
- An unseen message is handled even if it arrives late or out of order.

## Push, and asking

- Core **pushes** tasks and settings to an Asset when they change. Assets never poll for work.
- An Asset may also **ask**, for example "send me my tasks" after reconnecting.
  Core answers with the same push messages.
- Both directions use the same messages. There is no separate request/response format.

## Delivering a task queue

Sending a whole queue at once could fail on a slow link. Instead:

1. Core owns an **ordered list of `task_id`s** for each Asset.
2. Core sends **each task as its own message** (a `control.command` or
   `control.settings` with a `task_id`), once.
3. The Asset reports its **queue**: the list of task IDs it has not finished, the
   running one included, in order (`report.status` kind `queue`).
4. Core resends a task only while the Asset has never shown it holds it: never
   listed in a queue report, never reported on. Once the Asset has shown it, Core
   never sends it again. Core also stops for good when the Asset goes
   [offline](#when-core-counts-an-asset-offline). Either side can ask for the queue at any time with
   `query.queue`, for example an Asset after reconnecting.
5. The Asset runs tasks in the order of the queue list it holds. There is no
   `task_seq` and no gap-wait timer.
6. An Asset never runs a `task_id` twice. A task it holds is ignored. For a task
   it has finished, it sends that task's final report again. It remembers at
   least its last 1024 finished `task_id`s.

### Final reports are acknowledged

When a task finishes (`completed`, `failed` or `cancelled`), the Asset keeps sending
that `report.status` as a retry, on each new link and every 10 s, until Core answers
it with `admin.reply` (`accepted`, `reply_from`/`reply_to` naming the report, and its
`task_id`). The Asset matches both, so after its `seq` restarts an old answer can't
close a new report. A lost answer is covered the same way: Core recognises the retry
and sends its answer again.

A task the Asset has shown it holds that leaves its queue with no final report is
waiting for that report. If the Asset restarted and lost it, the outcome is unknown;
Core does not send the task again.

## Immediate commands and cancel

- A motion command without `task_id` (takeoff, move_to, land, return_to_home) runs now and **cancels the rest of the queue**. The Asset reports each cancelled task (`report.status` kind `task`, `cancelled`) and then its empty queue.
- A `control.settings` without `task_id` runs now beside the queue and does not cancel it.
- `control.cancel` stops a command partway, for example a landing. It never creates a task.
  - Core passes on a cancel with `task_id` only for a task that has not finished. It refuses an unknown `task_id` ("A1 has no task T9") and a finished one ("T3 is already completed").
  - With `task_id` for a queued task, that task is dropped and the running one carries on. With `task_id` for the active task, or without `task_id`, the motion running now stops.
  - When the Asset stops motion, it holds (hovers, or stays on the ground) and sets `run_state` paused. Core resumes it with `run_state: running` or sends a new command. A new immediate command runs at once and the Asset stays paused: queued tasks, new ones included, wait for `run_state: running`.
  - The Asset reports the task cancelled, then its queue. It answers every cancel with `report.settings`, `reply_from`/`reply_to` naming the cancel. A cancel that changes no setting (a queued task dropped) is answered with `run_state` unchanged.
  - For a task it has already finished, the Asset changes nothing and sends that task's final report again. For a task it has not received yet, it remembers the `task_id` as cancelled, reports it cancelled, and never runs it.

## Settings

- After each accepted hello the Asset sends its **connect report**: a `report.settings`
  with every setting it supports and its value. Core refuses changes to any setting the
  latest connect report left out, and the Asset never reports one until its next hello.
  Core acknowledges the connect report with `admin.reply`, and the Asset sends nothing
  after it until then (see [After reconnecting](#after-reconnecting-asset)), so a later
  partial report is never taken for the full list.
- A later `report.settings` may carry only some settings. A setting left out is
  unchanged, not unsupported.
- Per setting, the newest `time` wins, wherever the report comes from (Core forwards
  reports unchanged). An Asset never sends two settings reports with the same
  `time`. An older report is kept in history and changes nothing.

## Losing the link

An Asset is **in contact** with Core while it hears **new** (non-duplicate) messages
**after its accepted hello** that name **this Asset** in `asset_id` and were **not**
sent by this Asset (`from` is not this Asset's id). That covers messages Core creates
(`admin.alive`, Core's final-report `admin.reply`) and messages Core forwards
unchanged (operator commands, settings, cancels, task bodies). It does not count an
open socket, a radio acknowledgement, or other Assets overheard on the mesh.

- So silence means something, Core is never quiet for long. When it has sent an Asset
  nothing new for a third of that Asset's `link_loss_after_s` (repeated answers to
  retries don't count), it sends `admin.alive` (`from` is `CORE`).
- The link is **lost** when the Asset has had no contact for `link_loss_after_s`
  (30 s unless set), timed on its own clock. A link that drops and comes back within
  that time is not lost.
- The `link_loss` failsafe then triggers once, with the Asset's `link_loss_response`.
  It can trigger again only after contact returns and is lost again.
- With `link_loss_response: continue` the Asset keeps its Task and queue.
- Link loss counts on the ground too. There every response except `continue` keeps the
  Asset on the ground and cancels its queue, so no queued takeoff starts while Core
  can't see it.

### When Core counts an Asset offline

Core uses the same rule from its side. An open link proves nothing: a drone behind
a gateway can be out of radio range while the gateway's link to Core stays open.

- An Asset is **connected** while it has an accepted hello on an open link and Core
  has heard a new (non-duplicate) message from it (`from` is its id) within its
  `link_loss_after_s`, timed on Core's clock. Otherwise it is **offline**. It is
  connected again as soon as Core hears something new from it.
- So a quiet Asset is not mistaken for a lost one, an Asset that has sent nothing
  new for a third of its `link_loss_after_s` sends `report.telemetry` early. The
  check-in carries useful data instead of an empty heartbeat. An Asset that lists
  no telemetry sends another report it lists, such as `report.status` kind `asset`.
- Core refuses `control.command`, `control.settings` and `control.cancel` for an
  offline Asset and holds nothing. The operator sends again once it is back.
- **Core never carries work across a disconnect.** When an Asset goes offline,
  Core stops resending every Task the Asset has not shown it holds, and never
  sends those Tasks again. Core records no final state for them, because it does
  not know whether they arrived. If the Asset later lists or reports on one, that
  report is the record.

## After reconnecting (Asset)

After each accepted hello the Asset, in this order:

1. Sends `admin.describe` and waits for Core's `admin.reply`.
2. Sends its connect `report.settings` (every setting it supports; see above) and waits
   for Core's `admin.reply`.

   It resends each unchanged every 10 s until answered, and sends nothing else first.

3. Resends any unacknowledged final task reports (retries, same bytes).
4. Sends its current queue report.
5. Sends `query.queue` so Core can resend anything missing.

An operator interface rebuilds what it knows from Core's connect push (see
[Operator interfaces](#operator-interfaces)).
