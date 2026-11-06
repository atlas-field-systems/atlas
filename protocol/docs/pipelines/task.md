# Pipeline: a task

How one Task is created, stored and moved, hop by hop. It uses the first-flight example (Task T2, a `control.command` of kind `move_to` with a `task_id`). Sizes are minified JSON / deflate, in bytes.

**Bloat is the enemy, but good organization is not bloat.** Each hop lists what could be removed.

```text
Operator interface ──1. operator WebSocket──▶ Core ──2. store───────▶ Core storage
        ▲                                          │  ▲
        └──────────7. to operator (pushed)─────────┘  └──6. update storage
                                                   │
                                     3. the Asset's link
                                                   ▼
                                                Gateway ──4. radio──▶ Asset
                                                   ▲                    │
                                                   └──5. report.status─┘
```

## 1. Operator interface → Core
- **Who:** an operator, using an operator interface.
- **Link:** the operator's WebSocket to Core (see [communication.md](../communication.md#operator-interfaces)).
- The interface sends a whole `control.command`. Core checks it against the Asset's `admin.describe`, answers `admin.reply`, and passes it on unchanged.
- **Bloat:** if the interface sends the finished `control.command`, Core needs no second format. One message, end to end, is the leanest choice.

## 2. Core stores the task
- Core keeps the message as received in its `tasks` table, beside the Task's latest state ([Storage](../storage.md#tasks)).
- **Bloat:** the row holds the message itself, not a second "task" format that repeats its fields.

## 3–4. Core → gateway → Asset
- **Who:** Core sends it, a gateway relays it over radio, and the Asset receives it.
- **Link:** IP to the gateway, then radio. Routing is the link's job: the gateway adds nothing, and a copy that arrives twice is dropped by `(from, seq, time)` ([communication.md](../communication.md#routing-and-duplicates)).
- **Message** (173 / 139). First-flight has no operator, so Core created this one; an operator's command keeps the operator's `from`:

  ```json
  {"type":"control.command","time":1793667605150,"seq":5,"from":"CORE","asset_id":"A1","kind":"move_to","task_id":"T2","destination":{"latitude":42.2761,"longitude":-71.8031}}
  ```
- **Bloat:**
  - Removed: `plan_id` and `task_count`, which repeated in every Task (27 bytes each). The queue report below now catches lost Tasks.
  - `"type":"control.command"` is 23 characters in every command. Link compression shrinks it; the name stays readable.
  - The gateway should relay the message unchanged. Any wrapper it adds is pure bloat.

## 5. Asset → Core: task status
- **Message** (133 / 102, the first status for T1):

  ```json
  {"type":"report.status","time":1793667605400,"seq":10,"from":"A1","asset_id":"A1","kind":"task","task_id":"T1","task_state":"active"}
  ```
- Each time a Task is added, the Asset sends its queue (124 / 103, after T3). Core sends the next Task only once the queue lists the one before, and resends any Task it sent that the Asset has never listed or reported on:

  ```json
  {"type":"report.status","time":1793667605300,"seq":9,"from":"A1","asset_id":"A1","kind":"queue","task_ids":["T1","T2","T3"]}
  ```
- **Bloat:** one status per state change, with no repeat of the task's fields. Good as is.
- `task_id` is unique per Asset, so the status needs nothing else to say which Task it means.
- A final status (completed, failed, cancelled) is resent unchanged until Core answers with `admin.reply` ([communication.md](../communication.md#final-reports-are-acknowledged)).

## 6. Core updates storage
- Core updates the Task's latest state and adds the report to `history` ([Storage](../storage.md#tasks)). A status only moves a Task forward, and the first final state stays.

## 7. Core → operator interface
- An operator interface can also ask Core with `query.core` (kind `history`). That hop is the operator WebSocket.
- Core forwards the same `report.status` message, unchanged, over the operator WebSocket.
- **Bloat:** forward the message itself, not a new "task view" format.
