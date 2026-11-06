# Open questions

Not decided yet. Planning comes before building.

## Message groups and the queue

- **Tasks and geo features.** How a Task links to a geo feature (not through `move_to`) is open.
- **What else registration contains.** `admin.describe` lists reports, commands and cameras; [Storage](storage.md) keeps them. Answered in 0.8: an Asset may say what it is with `entity_type`.
- **`reply_to` through Core.** Answered in 0.8: every message carries `from`; Core forwards unchanged; replies use `reply_from` + `reply_to` naming (`from`, `seq`).

## Earlier

- **Future Asset data.** Answered: each new fixed report is a Protocol change the owner approves.
- **Queued settings confirmation.** Answered in 0.8: the Asset sends `report.settings` naming the Task, like an immediate change. One overtaken by a newer change is still `completed`.
- **Errors back to an Asset.** Not yet: Core drops and logs an invalid report, and the Asset gets only acknowledgements. Revisit after first flight.
- **What "latest state" includes.** Answered in 0.8: Core's connect push has each Asset's `admin.describe` and newest reports, its queue report included. The SDK live picture is opt-in; on disconnect the last snapshot stays readable as `stale: true`.
- **One level deeper?** Answered: no. `kind` stays its own field.
- **Additive changes and the version.** Answered: every change after a release is a new version, additive or not (law 10). Ends never ignore unknown fields.
- **Same target, two observation IDs.** Answered: the fusion module decides, also when several Assets see the same thing.
- **Holding commands for offline Assets.** Answered in 0.8: Core refuses and holds nothing, counts an Asset offline by contact rather than an open link, and never carries work across a disconnect (see [communication.md](communication.md#when-core-counts-an-asset-offline)). Revisit only if it becomes a real problem.
- **Observation types.** Answered in 0.8: observation kinds `coordinates` and `bearing`, a shared `entity_type`, uncertainty areas, and a fixed list of `details`. See [decisions](decisions.md#storage-sensors-and-registration).

Most of these are answered in [communication.md](communication.md).

- **Command acknowledgement.** Answered for operators: `admin.reply` says accepted or refused; the Asset's reports give the observed result.
- **Queue and task-list delivery.** Answered in 0.8: Core-owned ordered `task_id` list; each body once, after the Asset holds the one before; Asset queue report; Core resends missing. No `task_seq`, no gap-wait.
- **Connect-time version check.** Answered by `admin.hello` and `admin.hello_reply`.
- **Failure reporting.** Answered by `report.failsafe`.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Answered: routing is the link's job; see [Routing and duplicates](communication.md#routing-and-duplicates).
- **Plugins.** Answered in 0.8: the `plugin` message group; see [decisions](decisions.md#plugins).
- **Encode/decode library and stress testing.** Build phase: SDK under `sdk/`, how-it-works locked in 0.8; implementation next.
