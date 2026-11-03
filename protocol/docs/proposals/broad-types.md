# Proposal: nested message groups

Status: **adopted**. The definitions now follow this. Kept as the record of why and of the size comparison. The open questions moved to [open-questions.md](../open-questions.md), and the first-flight examples moved to `examples/first-flight/`, where the Plan's three tasks are now sent together before the run starts.

## Why

- The developer reversed "each command is its own message type, no wrapper". A long flat list of types is hard to read and to maintain.
- Messages are organised like nested folders instead. A few **groups** hold a few **types**, and a type picks its exact message with **`kind`**.
- The nesting is for people reading, defining and browsing messages.
- What goes over a link can be squeezed later (see "On the wire"). That doesn't change the readable form.

## 1. The tree

```text
admin                 setting up and running the link
├── hello             Asset → Core: first message, protocol_version
└── hello_reply       Core → Asset: accepted or version_mismatch
control               Core telling an Asset what to do
├── command           do it now, never queued
│   └── kind: takeoff · move_to · land · change_settings
└── task              one use of a command, queued in a plan
    └── kind: same as command, plus plan_id, task_id, task_count
report                everything an Asset tells Core
├── status
│   └── kind: asset · task · plan
├── failsafe          kept apart from status so it can carry more context
│   └── kind: return_home · link_loss_response
├── telemetry
└── settings          a report; reply_to when confirming Core's change
```

**Where failsafe goes:** it sits under `report`, as its own type beside `status`.
- It is something the drone tells Core, so it belongs with the other reports.
- As its own type, it can grow its own fields (what triggered it, where it is heading) without crowding `status`.
- If failsafes get many kinds of their own, `report.failsafe` can become its own group later without breaking anything else.

Later, `admin` is also where other link business goes, such as gateway registration (gateways will likely say Hello like Assets), time sync or goodbye.

**Command and task:**
- A **command** is something you can tell an Asset to do, such as `move_to`.
- A **task** is one use of a command. An Asset has a queue of tasks, not commands.
- `task` reuses `command`'s kinds and fields, so each kind is defined once.

**Plans:**
- Each task carries `plan_id`, `task_id` and `task_count`. There's no separate plan message that could be lost.
- Once the Asset holds all `task_count` tasks, it confirms with `report.status`, `kind: plan`, `plan_state: running`.

**Settings:**
- An Asset's settings at connect, or when it changes one itself, is a report and needs no confirmation.
- **Immediate change (the easy default, a button press):** Core sends `control.command`, `kind: change_settings`. The Asset confirms with `report.settings` whose `reply_to` is Core's `seq`.
- **Queued change:** a `control.task` with `kind: change_settings` (for example move_to, change a setting, move_to). It is confirmed by its task status.

## 2. How a nested message looks

**Chosen: a dotted path in `type`, everything else stays flat.**

```json
{
  "type": "control.task",
  "kind": "move_to",
  "time": 1793667613200,
  "seq": 3,
  "asset_id": "A1",
  "plan_id": "P1",
  "task_id": "T2",
  "task_count": 3,
  "destination": { "latitude": 42.2761, "longitude": -71.8031 }
}
```

Read it like a folder path: `control` › `task` › `move_to`.

**Alternative, not chosen: nested objects**, such as `{"control":{"task":{"kind":"move_to",...}}}`.
- It mirrors the folders literally.
- But it adds two levels of braces to every message.
- It moves the header out of a fixed place and makes field paths longer, like `control.task.destination.latitude`.
- So it is harder to read and bigger, for no gain.

**Also possible:** fold `kind` into the path too, as `"type": "control.task.move_to"`. That's one field instead of two and is even more folder-like, but it goes against the "`kind` everywhere" answer.

**Definitions follow the same tree:**
- Files would live at `definitions/messages/admin/hello.json`, `definitions/messages/control/task.json`, `definitions/messages/report/telemetry.json`, and so on.
- `index.json` groups would nest the same way.
- The viewer's left menu would become a tree: Report › Status › Task.

## 3. On the wire

- The readable form above is what people see.
- A link can send a compact form instead: the same message with `type` replaced by a small number from a fixed table generated from the tree, such as `admin.hello` = 0 … `report.settings` = 7.
- This sits with the short keys already deferred to protocol 1.0, so nothing changes now.

| First-flight run | Minified | Deflate |
|---|---|---|
| Today (#13, 21 messages) | 3,108 | 2,442 |
| Proposed, readable (22 messages) | 3,630 | 2,784 |
| Proposed, `type` as a number | 3,304 | 2,590 |

**Where the readable +522 / +342 bytes come from:**
- **The group prefix in `type`:** about 7 bytes per message.
- **The `kind` field:** 15–20 bytes on each status and failsafe message.
- **Each task's `plan_id`, `task_id` and `task_count`:** about 45 bytes each.
- **The plan confirmation:** 121 bytes.

The task fields and the plan confirmation are new information that fills the first-flight task-assignment gap. With `type` sent as a number, only +196 / +148 is left, and nearly all of that is the new information.

## 4. Every current message, mapped

| Now | Proposed |
|---|---|
| `hello`, `hello_reply` | `admin.hello`, `admin.hello_reply` |
| `takeoff`, `move_to`, `land` | `control.command` or `control.task` with that `kind` |
| `change_setting` | `control.command` (immediate) or `control.task` (queued), `kind: change_settings` |
| `status` | `report.status`, `kind: asset` |
| `task_status` | `report.status`, `kind: task` |
| (none) | `report.status`, `kind: plan` (new) |
| `failsafe_status` | `report.failsafe`, `kind` = the failsafe |
| `telemetry` | `report.telemetry` |
| `settings` | `report.settings`, optional `reply_to` |

Settings examples (minified / deflate bytes):

```text
{"type":"control.command","time":1793667620000,"seq":9,"asset_id":"A1","kind":"change_settings","lights":"on"}  110 / 97
{"type":"report.settings","time":1793667620150,"seq":12,"asset_id":"A1","reply_to":9,"lights":"on"}             99 / 87
```

## 5. The 22 first-flight messages, old and new

- These were the proposal's examples. The real ones are now `examples/first-flight/`, checked against the definitions by `npm test`.
- Takeoff, Move To and Land become tasks T1–T3 of plan P1.
- 06b is the new plan confirmation. Positions and `seq` match the old run so each row compares like for like.

Sizes are minified / deflate (level 9) bytes.

| # | Old type | New type | Old | New | Change |
|---|---|---|---|---|---|
| 01 | `hello` | `admin.hello` | 86 / 80 | 92 / 85 | +6 / +5 |
| 02 | `hello_reply` | `admin.hello_reply` | 118 / 98 | 124 / 105 | +6 / +7 |
| 03 | `settings` | `report.settings` | 158 / 124 | 165 / 128 | +7 / +4 |
| 04 | `status` | `report.status` (asset) | 84 / 80 | 106 / 92 | +22 / +12 |
| 05 | `telemetry` | `report.telemetry` | 235 / 170 | 242 / 177 | +7 / +7 |
| 06 | `takeoff` | `control.task` (takeoff) | 127 / 102 | 194 / 138 | +67 / +36 |
| 07 | `task_status` | `report.status` (task) | 104 / 85 | 120 / 96 | +16 / +11 |
| 08 | `telemetry` | `report.telemetry` | 236 / 172 | 243 / 177 | +7 / +5 |
| 09 | `task_status` | `report.status` (task) | 107 / 88 | 123 / 99 | +16 / +11 |
| 10 | `move_to` | `control.task` (move_to) | 119 / 104 | 186 / 140 | +67 / +36 |
| 11 | `task_status` | `report.status` (task) | 104 / 86 | 120 / 96 | +16 / +10 |
| 12 | `telemetry` | `report.telemetry` | 239 / 174 | 246 / 179 | +7 / +5 |
| 13 | `task_status` | `report.status` (task) | 108 / 88 | 124 / 99 | +16 / +11 |
| 14 | `land` | `control.task` (land) | 186 / 137 | 253 / 172 | +67 / +35 |
| 15 | `task_status` | `report.status` (task) | 105 / 86 | 121 / 97 | +16 / +11 |
| 16 | `telemetry` | `report.telemetry` | 237 / 172 | 244 / 176 | +7 / +4 |
| 17 | `task_status` | `report.status` (task) | 108 / 89 | 124 / 98 | +16 / +9 |
| 18 | `failsafe_status` | `report.failsafe` (link_loss_response) | 152 / 125 | 148 / 126 | -4 / +1 |
| 19 | `task_status` | `report.status` (task) | 147 / 119 | 163 / 128 | +16 / +9 |
| 20 | `task_status` | `report.status` (task) | 108 / 89 | 124 / 98 | +16 / +9 |
| 21 | `telemetry` | `report.telemetry` | 240 / 174 | 247 / 181 | +7 / +7 |
| 06b | (none) | `status` (plan) | — | 121 / 97 | +121 / +97 |
| | **Total** | | **3108 / 2442** | **3630 / 2784** | **+522 / +342** |

```text
01 old {"type":"hello","time":1793667600000,"seq":1,"asset_id":"A1","protocol_version":"0.3"}
01 new {"type":"admin.hello","time":1793667600000,"seq":1,"asset_id":"A1","protocol_version":"0.3"}

02 old {"type":"hello_reply","time":1793667600200,"seq":1,"asset_id":"A1","hello_result":"accepted","protocol_version":"0.3"}
02 new {"type":"admin.hello_reply","time":1793667600200,"seq":1,"asset_id":"A1","hello_result":"accepted","protocol_version":"0.3"}

03 old {"type":"settings","time":1793667600400,"seq":2,"asset_id":"A1","run_state":"running","lights":"off","landing_gear":"down","link_loss_response":"return_home"}
03 new {"type":"report.settings","time":1793667600400,"seq":2,"asset_id":"A1","run_state":"running","lights":"off","landing_gear":"down","link_loss_response":"return_home"}

04 old {"type":"status","time":1793667600600,"seq":3,"asset_id":"A1","condition":"healthy"}
04 new {"type":"report.status","time":1793667600600,"seq":3,"asset_id":"A1","kind":"asset","condition":"healthy"}

05 old {"type":"telemetry","time":1793667601000,"seq":4,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":0,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":0,"battery_percent":98}
05 new {"type":"report.telemetry","time":1793667601000,"seq":4,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":0,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":0,"battery_percent":98}

06 old {"type":"takeoff","time":1793667605000,"seq":2,"asset_id":"A1","target_altitude":{"altitude_m":30,"altitude_reference":"home"}}
06 new {"type":"control.task","time":1793667605000,"seq":2,"asset_id":"A1","kind":"takeoff","plan_id":"P1","task_id":"T1","task_count":3,"target_altitude":{"altitude_m":30,"altitude_reference":"home"}}

07 old {"type":"task_status","time":1793667605300,"seq":5,"asset_id":"A1","task_id":"T1","task_state":"active"}
07 new {"type":"report.status","time":1793667605300,"seq":5,"asset_id":"A1","kind":"task","task_id":"T1","task_state":"active"}

08 old {"type":"telemetry","time":1793667609000,"seq":6,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":15,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":0,"battery_percent":96}
08 new {"type":"report.telemetry","time":1793667609000,"seq":6,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":15,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":0,"battery_percent":96}

09 old {"type":"task_status","time":1793667613000,"seq":7,"asset_id":"A1","task_id":"T1","task_state":"completed"}
09 new {"type":"report.status","time":1793667613000,"seq":7,"asset_id":"A1","kind":"task","task_id":"T1","task_state":"completed"}

10 old {"type":"move_to","time":1793667613200,"seq":3,"asset_id":"A1","destination":{"latitude":42.2761,"longitude":-71.8031}}
10 new {"type":"control.task","time":1793667613200,"seq":3,"asset_id":"A1","kind":"move_to","plan_id":"P1","task_id":"T2","task_count":3,"destination":{"latitude":42.2761,"longitude":-71.8031}}

11 old {"type":"task_status","time":1793667613500,"seq":8,"asset_id":"A1","task_id":"T2","task_state":"active"}
11 new {"type":"report.status","time":1793667613500,"seq":8,"asset_id":"A1","kind":"task","task_id":"T2","task_state":"active"}

12 old {"type":"telemetry","time":1793667630000,"seq":9,"asset_id":"A1","position":{"latitude":42.2753,"longitude":-71.8047,"altitudes":[{"altitude_m":30,"altitude_reference":"home"}]},"ground_speed_mps":6.5,"heading_deg":58,"battery_percent":91}
12 new {"type":"report.telemetry","time":1793667630000,"seq":9,"asset_id":"A1","position":{"latitude":42.2753,"longitude":-71.8047,"altitudes":[{"altitude_m":30,"altitude_reference":"home"}]},"ground_speed_mps":6.5,"heading_deg":58,"battery_percent":91}

13 old {"type":"task_status","time":1793667648000,"seq":10,"asset_id":"A1","task_id":"T2","task_state":"completed"}
13 new {"type":"report.status","time":1793667648000,"seq":10,"asset_id":"A1","kind":"task","task_id":"T2","task_state":"completed"}

14 old {"type":"land","time":1793667648200,"seq":4,"asset_id":"A1","landing_position":{"latitude":42.2746,"longitude":-71.8063},"transit_altitude":{"altitude_m":20,"altitude_reference":"home"}}
14 new {"type":"control.task","time":1793667648200,"seq":4,"asset_id":"A1","kind":"land","plan_id":"P1","task_id":"T3","task_count":3,"landing_position":{"latitude":42.2746,"longitude":-71.8063},"transit_altitude":{"altitude_m":20,"altitude_reference":"home"}}

15 old {"type":"task_status","time":1793667648500,"seq":11,"asset_id":"A1","task_id":"T3","task_state":"active"}
15 new {"type":"report.status","time":1793667648500,"seq":11,"asset_id":"A1","kind":"task","task_id":"T3","task_state":"active"}

16 old {"type":"telemetry","time":1793667680000,"seq":12,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":0,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":58,"battery_percent":84}
16 new {"type":"report.telemetry","time":1793667680000,"seq":12,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":0,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":58,"battery_percent":84}

17 old {"type":"task_status","time":1793667680300,"seq":13,"asset_id":"A1","task_id":"T3","task_state":"completed"}
17 new {"type":"report.status","time":1793667680300,"seq":13,"asset_id":"A1","kind":"task","task_id":"T3","task_state":"completed"}

18 old {"type":"failsafe_status","time":1793667640000,"seq":9,"asset_id":"A1","failsafe":"link_loss_response","explanation":"No contact with gateway for 30 s"}
18 new {"type":"report.failsafe","time":1793667640000,"seq":9,"asset_id":"A1","kind":"link_loss_response","explanation":"No contact with gateway for 30 s"}

19 old {"type":"task_status","time":1793667640100,"seq":10,"asset_id":"A1","task_id":"T2","task_state":"failed","explanation":"Link lost, returning home"}
19 new {"type":"report.status","time":1793667640100,"seq":10,"asset_id":"A1","kind":"task","task_id":"T2","task_state":"failed","explanation":"Link lost, returning home"}

20 old {"type":"task_status","time":1793667640200,"seq":11,"asset_id":"A1","task_id":"T3","task_state":"cancelled"}
20 new {"type":"report.status","time":1793667640200,"seq":11,"asset_id":"A1","kind":"task","task_id":"T3","task_state":"cancelled"}

21 old {"type":"telemetry","time":1793667652000,"seq":12,"asset_id":"A1","position":{"latitude":42.275,"longitude":-71.8055,"altitudes":[{"altitude_m":30,"altitude_reference":"home"}]},"ground_speed_mps":6.5,"heading_deg":238,"battery_percent":88}
21 new {"type":"report.telemetry","time":1793667652000,"seq":12,"asset_id":"A1","position":{"latitude":42.275,"longitude":-71.8055,"altitudes":[{"altitude_m":30,"altitude_reference":"home"}]},"ground_speed_mps":6.5,"heading_deg":238,"battery_percent":88}

06b new {"type":"report.status","time":1793667605600,"seq":5,"asset_id":"A1","kind":"plan","plan_id":"P1","plan_state":"running"}
```

## 6. What would change

- **Laws:**
  - Law 7 becomes "messages are grouped in a tree; `type` is the dotted path, and `kind` picks the exact message".
  - Law 2 (flat) stays for the fields: the tree lives only in the `type` name.
- **decisions.md:**
  - Record the reversal and the tree (done here, as proposed).
  - Then update Every message, Commands, Connect and reports, and Settings to match.
- **Definitions:**
  - Message files move into group folders (`messages/admin/`, `messages/control/`, `messages/report/`).
  - Kinds become `oneOf` branches keyed on `kind`, and `task` reuses `command`'s kinds.
  - New variables: `kind`, `plan_id`, `plan_state`, `task_count`, `reply_to`.
  - The `type` maxLength (32) still fits the longest path, `admin.hello_reply` (17).
- **check.mjs:**
  - `type` must equal the folder path plus file name.
  - Every `oneOf` branch fixes `kind` to one value, and kinds are unique within a type.
  - "Only references" must accept `oneOf` branches.
- **Viewer and CLI:**
  - A tree menu (group › type › kind), with examples and fields per kind.
  - Still read everything from `definitions/` and never name a message.
- **First-flight (#13):** switch to these examples and regenerate the doc once the definitions change.

## 7. Open questions

1. If some of a plan's tasks never arrive, does the Asset report `plan_state: incomplete`, or stay silent until Core resends?
2. When a queued `change_settings` task runs, does the Asset also send `report.settings` with `reply_to`, or is the task status enough?
3. If a `control.command` arrives while a plan runs, does it pause the plan or run beside it?
4. New: should the tree go one level deeper, with `kind` folded into the path as `control.task.move_to`?
