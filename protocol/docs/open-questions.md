# Open questions

Not decided yet. Planning comes before building.

## Message groups and the queue

- **What registration contains.** `admin.hello` now lists the reports an Asset sends. What else an Asset must say about itself when it registers (what it is, what it can do) depends on what Core stores for each Asset, so it is tied to the storage formats, which are deferred.
- **Future Asset data.** New kinds of Asset data each get a new fixed report, listed in `reports`. Who decides when one is added is open.
- **Queued settings confirmation.** When a queued `control.settings` Task runs, does the Asset also send `report.settings` with `reply_to`, or is the task status enough?
- **One level deeper?** Should `kind` be folded into the path (`"type": "control.command.move_to"`), making one field instead of two?

## Earlier

A draft answer to several of these (envelope, acknowledgement, queue delivery,
version check, gateways) is in [communication.md](communication.md).

- **Message envelope.** Deferred: to be detailed later, when the details of how messages travel are nailed down.
  Messages like Takeoff will not be sent bare. They will be
  carried inside something that explains the context, for example a task list
  pushed to an Asset when it asks "what tasks do I have?".
- **Command acknowledgement.** How a command is acknowledged, keeping "accepted"
  separate from "observed result".
- **Queue and task-list delivery.** Partly answered: each Task is a `control.command` or `control.settings` with `task_id`, and the Asset answers with its queue (`report.status` kind `queue`). How they travel over the link is still open.
- **Connect-time version check.** Answered by `admin.hello` and `admin.hello_reply`.
- **Failure reporting.** Answered by `report.failsafe`.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Core talks to a gateway over IP through an API defined in the SDK.
  The gateway-to-Asset edge link is different, because of bandwidth limits.
- **Plugins.** Deferred; the system may be reimagined.
- **Encode/decode library and stress testing.** Build phase, after planning.
