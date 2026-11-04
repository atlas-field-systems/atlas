# Open questions

Not decided yet. Planning comes before building.

## Message groups and the queue

- **Tasks and geo features.** How a Task links to a geo feature (not through `move_to`) is open.
- **Observation types.** Deferred: what a target is (person, vehicle, ...), and richer observations such as bearing-only (no position) and ADS-B with its many extra fields, which must still be shown on observations and tracks.
- **What else registration contains.** `admin.hello` lists reports and cameras, and [Storage](storage.md) keeps them. Whether an Asset should also say what it is (drone, camera post) or which commands it supports is open.
- **Future Asset data.** New kinds of Asset data each get a new fixed report, listed in `reports`. Who decides when one is added is open.
- **Queued settings confirmation.** When a queued `control.settings` Task runs, does the Asset also send `report.settings` with `reply_to`, or is the task status enough?
- **Errors back to an Asset.** An Asset gets no reply (except Core's acknowledgement of a final task report), so an invalid report is dropped and logged by Core and the Asset never learns. Should there be an error message to Assets?
- **`reply_to` through Core.** Core forwards an operator's `control.settings` with its own `seq`, so the Asset's `report.settings` `reply_to` names Core's `seq`, not the operator's. Should Core map it back when forwarding?
- **What "latest state" includes.** On connect Core pushes each Asset's hello and newest reports. Is the queue part of it, and should an operator see a connected or stale flag, rather than working it out from report times?
- **Holding commands for offline Assets.** Refused for now (0.6). Revisit if store-and-forward links need it.
- **One level deeper?** Should `kind` be folded into the path (`"type": "control.command.move_to"`), making one field instead of two?

## Earlier

- **Same target, two observation IDs.** Answered: the fusion module decides, also when several Assets see the same thing.

A draft answer to several of these (envelope, acknowledgement, queue delivery,
version check) is in [communication.md](communication.md).

- **Message envelope.** Deferred: to be detailed later, when the details of how messages travel are nailed down.
  Messages like Takeoff will not be sent bare. They will be
  carried inside something that explains the context, for example a task list
  pushed to an Asset when it asks "what tasks do I have?".
- **Command acknowledgement.** Answered for operators: `admin.reply` says accepted or refused; the Asset's reports give the observed result.
- **Queue and task-list delivery.** Partly answered: each Task is a `control.command` or `control.settings` with `task_id`, and the Asset answers with its queue (`report.status` kind `queue`). How they travel over the link is still open.
- **Connect-time version check.** Answered by `admin.hello` and `admin.hello_reply`.
- **Failure reporting.** Answered by `report.failsafe`.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Answered: routing is the link's job; see [Routing and duplicates](communication.md#routing-and-duplicates).
- **Plugins.** Deferred; the system may be reimagined.
- **Encode/decode library and stress testing.** Build phase, after planning.
