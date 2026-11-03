# Open questions

Not decided yet. Planning comes before building.

## Message groups and plans

- **Incomplete plans.** If some of a Plan's Tasks never arrive, does the Asset report `plan_state: incomplete`, or stay silent until Core resends?
- **Queued settings confirmation.** When a queued `change_settings` task runs, does the Asset also send `report.settings` with `reply_to`, or is the task status enough?
- **Commands during a plan.** If a `control.command` arrives while a Plan runs, does it pause the Plan or run beside it?
- **One level deeper?** Should `kind` be folded into the path (`"type": "control.task.move_to"`), making one field instead of two?

## Earlier

A draft answer to several of these (envelope, acknowledgement, queue delivery,
version check, gateways) is in [communication.md](communication.md).

- **Message envelope.** Deferred: to be detailed later, when the details of how messages travel are nailed down.
  Messages like Takeoff will not be sent bare. They will be
  carried inside something that explains the context, for example a task list
  pushed to an Asset when it asks "what tasks do I have?".
- **Command acknowledgement.** How a command is acknowledged, keeping "accepted"
  separate from "observed result".
- **Queue and task-list delivery.** Partly answered: each `control.task` carries `plan_id`, `task_id` and `task_count`, and the Asset confirms the whole Plan with `report.status` kind `plan`. How they travel over the link is still open.
- **Connect-time version check.** Answered by `admin.hello` and `admin.hello_reply`.
- **Failure reporting.** Answered by `report.failsafe`.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Core talks to a gateway over IP through an API defined in the SDK.
  The gateway-to-Asset edge link is different, because of bandwidth limits.
- **Plugins.** Deferred; the system may be reimagined.
- **Encode/decode library and stress testing.** Build phase, after planning.
