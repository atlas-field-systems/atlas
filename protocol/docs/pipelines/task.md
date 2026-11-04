# Pipeline: a task

How one Task is created, stored and moved, hop by hop. It uses the first-flight example (Task T2, a `control.command` of kind `move_to` with a `task_id`). Sizes are minified JSON / deflate, in bytes.

**Bloat is the enemy, but good organization is not bloat.** Each hop lists what could be removed.

```text
Operator interface ──1. operator WebSocket──▶ Core ──2. store (GAP)──▶ Core storage
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
- The interface sends a whole `control.command`. Core checks it against the Asset's hello, answers `admin.reply`, and sends it on with its own `seq`.
- **Bloat:** if the interface sends the finished `control.command`, Core needs no second format. One message, end to end, is the leanest choice.

## 2. Core stores the task
- **GAP:** the storage layout is deferred ([storage](../../storage/README.md)).
- Sketch, not decided: store the message as received, plus one receive time.

  ```json
  {"received":1793667605060,"message":{"type":"control.command","kind":"move_to","task_id":"T2","...":"..."}}
  ```
- **Bloat:** do not add a separate "task" record that repeats the message's fields. Also, do not store `task_state` beside the message twice (once here, once in the status log).

## 3–4. Core → gateway → Asset
- **Who:** Core sends it, a gateway relays it over radio, and the Asset receives it.
- **Link:** IP to the gateway, then radio. Routing is the link's job: the gateway adds nothing, and a copy that arrives twice is dropped by `(sender, seq)` ([communication.md](../communication.md#routing-and-duplicates)).
- **Message** (159 / 128; it was 186 / 140 with Plans):

  ```json
  {"type":"control.command","time":1793667605050,"seq":3,"asset_id":"A1","kind":"move_to","task_id":"T2","destination":{"latitude":42.2761,"longitude":-71.8031}}
  ```
- **Bloat:**
  - Removed: `plan_id` and `task_count`, which repeated in every Task (27 bytes each). The queue report below now catches lost Tasks.
  - `"type":"control.command"` is 23 characters in every command. Short keys are deferred to 1.0.
  - The gateway should relay the message unchanged. Any wrapper it adds is pure bloat.

## 5. Asset → Core: task status
- **Message** (120 / 101, the first status for T1):

  ```json
  {"type":"report.status","time":1793667605400,"seq":7,"asset_id":"A1","kind":"task","task_id":"T1","task_state":"active"}
  ```
- Once Tasks are added, the Asset sends its queue (112 / 97). Core resends any Task missing from the list:

  ```json
  {"type":"report.status","time":1793667605300,"seq":6,"asset_id":"A1","kind":"queue","task_ids":["T1","T2","T3"]}
  ```
- **Bloat:** one status per state change, with no repeat of the task's fields. Good as is.
- `task_id` is unique per Asset, so the status needs nothing else to say which Task it means.

## 6. Core updates storage
- **GAP:** the storage layout is not defined. Sketch, not decided: add the status message to the log. The current state is the latest status by `time` (an older time never overwrites newer state).
- **Bloat:** keep one log, not a log and a separate "current state" copy, unless reading speed needs it.

## 7. Core → operator interface
- An operator interface can also ask Core with `query.core` (kind `history`). That hop is the operator WebSocket.
- Core forwards the same `report.status` message, unchanged, over the operator WebSocket.
- **Bloat:** forward the message itself, not a new "task view" format.
