# Open questions

Not decided yet. Planning comes before building.

## Message groups and the queue

- **Tasks and geo features.** How a Task links to a geo feature (not through `move_to`) is open.
- **Observation types.** Deferred: what a target is (person, vehicle, ...), and richer observations such as bearing-only (no position) and ADS-B with its many extra fields, which must still be shown on observations and tracks.
- **What else registration contains.** `admin.describe` lists reports, commands and cameras; [Storage](storage.md) keeps them. Whether an Asset should also say what it is (drone, camera post) is open.
- **Future Asset data.** New kinds of Asset data each get a new fixed report, listed in `reports`. Who decides when one is added is open.
- **Queued settings confirmation.** When a queued `control.settings` Task runs, does the Asset also send `report.settings` with `reply_to`, or is the task status enough?
- **Errors back to an Asset.** An Asset gets no reply (except Core's acknowledgement of a final task report), so an invalid report is dropped and logged by Core and the Asset never learns. Should there be an error message to Assets?
- **`reply_to` through Core.** Answered in 0.8: every message carries `from`; Core forwards unchanged; replies use `reply_from` + `reply_to` naming (`from`, `seq`).
- **What "latest state" includes.** Partly answered in 0.8: on connect Core pushes each Asset's `admin.describe` and newest reports. The SDK live picture is opt-in; on disconnect the last snapshot stays readable as `stale: true`. Whether the queue is always in the connect push stays open.
- **Additive changes and the version.** The Charter says changes to meaning are additive and only breaking changes matter for the version. But law 10 refuses any version difference, and every message rejects fields it does not define, so an older Core or Asset rejects a new field. Today every change to messages needs a new version. Should an end ignore unknown fields so additive changes keep the version, or should the Charter say every change is versioned?
- **One level deeper?** Should `kind` be folded into the path (`"type": "control.command.move_to"`), making one field instead of two?

## Earlier

- **Same target, two observation IDs.** Answered: the fusion module decides, also when several Assets see the same thing.
- **Holding commands for offline Assets.** Answered in 0.8: Core refuses and holds nothing, counts an Asset offline by contact rather than an open link, and never carries work across a disconnect (see [communication.md](communication.md#when-core-counts-an-asset-offline)). Revisit only if it becomes a real problem.

Most of these are answered in [communication.md](communication.md).

- **Message envelope.** Partly answered in 0.8 for the queue: Core owns an ordered `task_id` list and sends each body once; the Asset reports the queue. A broader envelope for other contexts stays deferred.
- **Command acknowledgement.** Answered for operators: `admin.reply` says accepted or refused; the Asset's reports give the observed result.
- **Queue and task-list delivery.** Answered in 0.8: Core-owned ordered `task_id` list; each body once; Asset queue report; Core resends missing. No `task_seq`, no gap-wait.
- **Connect-time version check.** Answered by `admin.hello` and `admin.hello_reply`.
- **Failure reporting.** Answered by `report.failsafe`.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Answered: routing is the link's job; see [Routing and duplicates](communication.md#routing-and-duplicates).
- **Plugins.** Deferred; the system may be reimagined.
- **Encode/decode library and stress testing.** Build phase: SDK under `sdk/`, how-it-works locked in 0.8; implementation next.
