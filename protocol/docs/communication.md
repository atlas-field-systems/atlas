# How Atlas parts communicate

How every part of Atlas behaves on a link. It spells out the
[laws](laws.md) in full. The SDK implements these rules; what it adds on top is in
the [SDK docs](../../sdk/README.md).

This page includes selected behavior not yet expressed by current definitions.
[Open contracts](open-questions.md#unresolved) identify the missing formats.

Core, gateways, Assets, and their SDK instances stay running for an operation
([operating assumption](../../atlas/using-atlas.md#the-four-pillars)). Recovery
here means restoring a dropped link in those same processes, with state retained
in memory. It does not include process restarts.

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
   id) and its 16-byte asset key (and the enrollment key the
   first time). Keys appear in no other message, and Core never sends one.
3. A bad key gets `refused`, and Core closes the link. Anything sent before an
   accepted hello closes the link too.
4. If the Asset already has a link open, the newer link replaces the older; Core
   closes the older.
5. After an accepted hello, the Asset sends `admin.describe` (reports, commands,
   cameras, no keys). Its command list is explicit, not inferred from modules or
   equipment drivers. Core stores it, acknowledges it with `admin.reply`, and
   forwards it unchanged to operators.

The Asset can start this sequence once identity, clock, and communications are
ready, even while equipment is starting or its position is unknown. A
reporting-only Asset can list no commands. Complete startup follows
[the applicable reconnect steps](#after-reconnecting-asset).

## Operator interfaces

An operator interface (a map, a console, a script) is just another link: **one
WebSocket per interface**, the same messages, pushed both ways, no polling.
No user accounts or roles.

1. The WebSocket opens and the interface's first message is `admin.operator_hello`:
   its `operator_id` (also `from`) and its 16-byte key. Core
   checks the key like an asset key (it stores only the hash) and answers
   `admin.hello_reply` with `operator_id`.
2. Each interface has its own `operator_id`. A newer link with the same ID replaces
   the older; Core closes the older.
3. Core pushes every Asset's latest `admin.describe` and each Asset's latest
   reports (settings, status, queue, telemetry, battery), **unchanged** (same
   `from`, `seq` and `time`). For settings, that is each report holding a
   setting's newest value, oldest first (see [Settings](#settings)). The selected
   subsystem model likewise retains the reports holding each subsystem's newest
   condition, rather than only the last health message. Its exact contract is
   still open. Core also sends one `plugin.describe` per Plugin, one
   `geofeature.set` per geo feature and
   one `object.describe` per Object.
4. From then on Core forwards each new report as it arrives: telemetry, status,
   queue changes and failsafes — still unchanged.
5. To act, the interface sends `control.command`, `control.settings`,
   `control.queue` or `control.cancel` with `asset_id` and its own `from`/`seq`. Core checks it
   against that Asset's declared command and settings support and applies
   [request admission](../../core/docs/requests.md) before forwarding. It passes
   accepted requests on **unchanged**, or refuses them with a reason. Anything
   sent to an Asset that is [offline](#when-core-counts-an-asset-offline) or not yet
   [ready](#after-reconnecting-asset) is refused; Core does not hold it. The
   interface picks each Task's `task_id`. Core refuses one that Asset has already
   had in this run ("A1 already has task T3"), so after a refresh, or with two
   interfaces open, the interface picks another and sends again. Core also refuses
   a `control.queue` that names a `task_id` it has no body for.
6. To read, it uses `query.core` and `query.asset`. With `every_s`, Core repeats
   its latest stored report unchanged, keeping the original `from`, `seq`, and
   `time`. Repeating a report does not make it a new measurement. Core sends a
   query's answer first and its `admin.reply` last to mark the end. An accepted
   reply alone means nothing matched. Live reports keep arriving meanwhile.
   The reader takes messages matching the query's fields as answers.
7. Core answers **every** operator message after the hello with one `admin.reply`:
   `accepted` or `refused` (with `explanation`), or for a `plugin.call` also
   `failed` (with `explanation`), `reply_from` + `reply_to` naming
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
- A creator's `seq` is one counter across all its links for the operation. It
  does not reset on reconnect. Core uses its own counter for messages it creates
  (`from` is `CORE`).
- A creator's clock never goes backwards during an operation, and a creator
  sends nothing until its clock is set. Clocks need not match exactly; the
  [operating assumption](../../atlas/environment.md#core-is-a-deliberate-dependency)
  excludes large clock errors.
- Asset and operator IDs must be unique across both groups. `CORE` is reserved
  for Core. Core refuses an ID belonging to another participant and authenticates
  reconnecting participants before replacing their links.
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
- An Asset **asks** by naming what it lacks: its queue report lists missing Task
  bodies, and Core resends them as the same push messages.
- Both directions use the same messages. There is no separate request/response format.

## Delivering a task queue

An Asset that accepts Tasks owns its task list and always holds every Task in
it, so it never waits to fetch the next one. A reporting-only Asset is not
required to have a queue or send queue reports.

1. **Bodies.** Each Task is a `control.command` or `control.settings` with a
   `task_id`, sent once, as soon as the operator adds it. Core passes every body on
   at once; arrival order does not matter.
2. **The list.** A `control.queue` carries the order, as `task_id`s only, and the
   `queue_version` it was built on. The Asset ignores a list built on any other version.
   Core resends a list unchanged until a queue report names it.
3. **A list takes effect only when complete.** Until the Asset holds every body in
   a new list, it keeps running its current list and names the missing bodies in its
   queue report (`missing_task_ids`). Core resends those bodies at once, and every
   10 s until a queue report no longer names them.
4. **The queue report** (`report.status` kind `queue`) lists the Tasks not started
   yet, in order, with the list's `queue_version`. The Asset sends it whenever the
   list or the missing bodies change, and when Core sends `query.queue`. Answering a
   `control.queue`, it names it with `reply_from`/`reply_to`.
5. **The version.** The Asset raises `queue_version` by one whenever its list
   changes: a new list takes effect, or it clears the list. Starting a Task does not
   raise it; the Asset skips any `task_id` in a list that it has already started or
   finished. It keeps its list, version and finished `task_id`s for the operation,
   including while its links are disconnected.
6. The Asset runs its list in order while `run_state` is `running`. A Task that
   leaves the list without starting is reported `cancelled`.
7. An Asset never runs a `task_id` twice. A resent body for a Task it holds is
   ignored; for a Task it has finished, it sends that Task's final report again. It
   remembers its finished `task_id`s for the whole operation.
8. **Clears.** A failed command always clears the remaining list, regardless of
   its configured safe response. A queued command's failed report stays failed.
   Each remaining Task is reported `cancelled`. Activating a failsafe or accepting
   an immediate motion command also clears the list. Clearing raises
   the version and reports the empty queue. A list built before the clear is
   ignored, so cleared work never comes back on its own. The Asset owns
   [failure and trigger behavior](../../asset/docs/failsafes.md).

### Final reports are acknowledged

When a task finishes (`completed`, `failed` or `cancelled`), the Asset keeps sending
that `report.status` as a retry, on each new link and every 10 s, until Core answers
it with `admin.reply` (`accepted`, `reply_from`/`reply_to` naming the report, and its
`task_id`). The Asset matches both the report identity and Task ID. A lost answer
is covered the same way: Core recognises the retry and sends its answer again.

## Immediate commands and cancel

These rules describe ordinary operation.
[Asset failsafe state](../../asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation)
overrides ordinary dispatch for the rest of the operation. Exact refusal messages
remain [open](open-questions.md#unresolved).

- A motion command without `task_id` (takeoff, move_to, land, return_to_home) runs now and clears the list (see Clears above).
- A `control.settings` without `task_id` runs now beside the list and does not clear it.
- `control.cancel` stops the motion running now; it never creates a Task. The Asset holds (hovers, or stays on the ground), sets `run_state` paused, reports the running Task `cancelled`, and answers with `report.settings` (`reply_from`/`reply_to` naming the cancel). Core resumes it with `run_state: running` or sends a new command, which runs at once while the Asset stays paused.
- To drop or reorder queued Tasks, send a new list.

## Settings

- `run_state: paused` pauses motion already underway as well as queue progression.
  The Asset owns the physical response under [Pause](../../asset/docs/README.md#pause).
- Settings travel together in one `settings` object, the same in `report.settings`
  and `control.settings`, so each setting is listed once.
- `home_position` is where `return_to_home` goes for Assets supporting that
  behavior. Position can come from equipment or manual configuration for a
  stationary Asset. The Asset owns [home initialization](../../asset/docs/README.md#position-and-home).
  Connecting does not require a known home, and reconnecting does not reset it.
- Settings support is declared independently of currently known values. Core
  refuses unsupported settings, but an unknown value does not imply unsupported.
  An Asset with no live settings needs no placeholder settings report.
- When settings apply, the Asset supplies its known current values at connection.
  Core acknowledges each required connect report with `admin.reply` before
  ordinary traffic (see [After reconnecting](#after-reconnecting-asset)). A later
  `report.settings` may carry only some values. An omitted value is unchanged.
- Independent support and setting-free startup await
  [exact contracts](open-questions.md#unresolved).
- The Asset applies each new valid immediate settings request when it receives
  it, alongside its local changes. Request timestamps do not choose the winner.
  A delayed distinct request can override a local change; a duplicate retry does
  not apply again. Configured safe responses still override ordinary settings.
- The Asset reports the resulting values. Core and pictures keep the newest
  Asset report per setting, ordered by that Asset's `time`, then `seq` when the
  times match. Both fields come from the same Asset, so no comparison between
  operator and Asset clocks is needed. Older reports stay in history and do not
  replace the current value.
- A `control.settings` Task is confirmed like an immediate one: when it runs, the Asset
  applies its settings and sends `report.settings` with `reply_from`/`reply_to`
  naming it. The body's send or arrival time does not make it obsolete; its
  execution follows queue order. A failure response still takes precedence.

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
- Contact loss is an input to the Asset's
  [configured conditions](../../asset/docs/failsafes.md#configure-conditions-as-well-as-responses),
  not an unconditional instruction to act.
- **Shared-contract gap.** The current `link_loss` report and `link_loss_response`
  setting still describe unconditional link-loss handling. The selected Asset
  behavior needs [new contracts](open-questions.md#unresolved). Contact timing and
  Core's offline classification below are separate from physical-response policy.

### When Core counts an Asset offline

Core uses the same rule from its side. An open link proves nothing: a drone behind
a gateway can be out of radio range while the gateway's link to Core stays open.

- An Asset is **connected** while it has an accepted hello on an open link and Core
  has heard a new (non-duplicate) message from it (`from` is its id) within its
  `link_loss_after_s`, timed on Core's clock. Otherwise it is **offline**. It is
  connected again as soon as Core hears something new from it.
- The current check-in procedure sends a listed report early when the Asset has
  sent nothing new for a third of its `link_loss_after_s`, normally telemetry.
  Only send position updates when position is valid. Receiving another report
  does not establish fresh position.
- **Shared-contract gap.** A quiet Asset may have neither a new measurement nor
  a relevant subsystem update. Selected [subsystem reporting](../../asset/docs/status.md)
  has no mandatory periodic health broadcast. How such an Asset checks in
  without manufacturing measurements or forcing subsystem updates remains
  [open](open-questions.md#unresolved).
- Core refuses `control.*` for an offline Asset and holds nothing new. The operator
  sends again once it is back. When it is back, its queue report names any body a
  waiting list still lacks, and Core resends it.

## After reconnecting (Asset)

After each accepted hello the SDK performs the applicable startup exchanges in
order. Connection readiness is separate from equipment readiness.

1. Send `admin.describe` and wait for Core's `admin.reply`.
2. Establish supported settings independently of known values. Send and await
   acknowledgement of applicable connect settings reports. An Asset with no
   settings skips those reports. Unknown equipment state or position does not
   hold the connection open indefinitely.
3. For an Asset accepting Tasks, resend unacknowledged final task reports as
   retries and send its queue report. Core resends any body it names as missing.
   A reporting-only Asset with no queue skips these steps.

Each required acknowledged exchange is resent unchanged every 10 s until
answered. Ordinary traffic starts only after the applicable required startup
acknowledgements. Core refuses `control.*` while the Asset is still connecting,
not merely because its equipment is starting. Missing pre-ready deliveries are
not treated as executed work.

An operator interface rebuilds what it knows from Core's connect push (see
[Operator interfaces](#operator-interfaces)).

## Report catch-up

An Asset delivers retained reports through the same SDK and report messages used
for live traffic. This applies after a disconnection and when an Asset has
recorded more samples than it could transmit live. A faster link can carry the
backlog.

Retained reports keep their original times and message identities. Retries
remain the same messages under [Routing and
duplicates](#routing-and-duplicates). Late reports enter
[history](storage.md#history) at their original times. Catch-up follows
applicable startup acknowledgements and respects live traffic. Transfer limits,
delivery tracking, and completion evidence still need
[contracts](open-questions.md#unresolved).
