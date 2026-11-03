# Pipeline: a task

How one task is created, stored and moved, hop by hop. It uses the first-flight example (task T2, `move_to`). Sizes are minified JSON / deflate, in bytes.

**Bloat is the main enemy.** Each hop lists what could be removed.

```text
Operator interface ──1. operator API, IP (GAP)──▶ Core ──2. store (GAP)──▶ Core storage
        ▲                                          │  ▲
        └──────────7. to operator (GAP)────────────┘  └──6. update storage
                                                   │
                                     3. IP (GAP: routing)
                                                   ▼
                                                Gateway ──4. radio──▶ Asset
                                                   ▲                    │
                                                   └──5. report.status──┘
```

## 1. Operator interface → Core
- **Who:** an operator, using an operator interface.
- **Link:** the operator API over IP.
- **GAP:** the operator API is not defined. It is unclear whether the interface sends a whole `control.task` or a smaller request that Core turns into one.
- **Bloat:** if the interface sends the finished `control.task`, Core needs no second format. One message, end to end, is the leanest choice.

## 2. Core stores the task
- **GAP:** the storage layout is deferred ([storage](../../storage/README.md)).
- Sketch, not decided: store the message as received, plus one receive time.

  ```json
  {"received":1793667605060,"message":{"type":"control.task","kind":"move_to","plan_id":"P1","task_id":"T2","...":"..."}}
  ```
- **Bloat:** do not add a separate "task" record that repeats the message's fields. Also, do not store `task_state` beside the message twice (once here, once in the status log).

## 3–4. Core → gateway → Asset
- **Who:** Core sends it, a gateway relays it over radio, and the Asset receives it.
- **Link:** IP to the gateway, then radio. **GAP:** how Core picks the gateway, and what the gateway adds, if anything, is not defined.
- **Message** (186 / 140):

  ```json
  {"type":"control.task","time":1793667605050,"seq":3,"asset_id":"A1","kind":"move_to","plan_id":"P1","task_id":"T2","task_count":3,"destination":{"latitude":42.2761,"longitude":-71.8031}}
  ```
- **Bloat:**
  - `plan_id` and `task_count` repeat in all 3 tasks (about 30 bytes each). This is on purpose, so no single lost message breaks the Plan, but it is the biggest repeat here.
  - `"type":"control.task"` is 20 characters in every task. Short keys are deferred to 1.0.
  - The gateway should relay the message unchanged. Any wrapper it adds is pure bloat.

## 5. Asset → Core: task status
- **Message** (120 / 101, the first status for T1):

  ```json
  {"type":"report.status","time":1793667605400,"seq":6,"asset_id":"A1","kind":"task","task_id":"T1","task_state":"active"}
  ```
- After all 3 tasks arrive, the Asset first sends one `report.status` of kind `plan` (`running`, 121 / 100).
- **Bloat:** one status per state change, with no repeat of the task's fields. Good as is.
- **Open:** the task status has no `plan_id`. That is fine only if `task_id` is unique per Asset across Plans. Not decided.

## 6. Core updates storage
- **GAP:** the storage layout is not defined. Sketch, not decided: add the status message to the log. The current state is the latest status by `time` (an older time never overwrites newer state).
- **Bloat:** keep one log, not a log and a separate "current state" copy, unless reading speed needs it.

## 7. Core → operator interface
- **GAP:** not defined. Sketch, not decided: Core forwards the same `report.status` message.
- **Bloat:** forward the message itself, not a new "task view" format.
