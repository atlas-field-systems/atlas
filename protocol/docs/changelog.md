# Changelog

## 0.8

- Origin: every message carries `from` (Asset id, operator id, or `CORE`). Core forwards other creators' messages unchanged. Duplicates are `(from, seq, time)`. Replies use `reply_from` + `reply_to`. Law 2 changed on purpose (flat messages with a creator).
- Handshake split: `admin.hello` is keys + version + id only. New keyless `admin.describe` carries reports, commands and cameras. `admin.asset` removed.
- Queue: drop `task_seq` and the gap-wait. Core owns an ordered list of `task_id`s; Asset reports the queue; Core resends missing bodies.
- SDK how-it-works locked under `sdk/`: shared `check()`, `request`/`stream`/`subscribe`, on-demand picture with opt-in live + `stale`, bytes-only adapters, one identity module, Asset auto-resync, no operator command auto-retry.
- Dedupe: act once, deliver always. A replayed message is not acted on again but is still delivered to streams, subscribers and the live picture; the picture upserts by `(from, seq, time)`.
- Asset reconnect order: after each accepted hello, describe → connect `report.settings` → unacked finals → queue report → `query.queue`.
- Link loss contact: any new (non-duplicate) message after the accepted hello that names this Asset in `asset_id` and was not sent by this Asset (not only `from: CORE`). Covers Core forwards of operator traffic.

## 0.7

- Duplicates: a message is identified by `(sender, seq, time)`. A retry is the same message unchanged and gets the same answer again. The "lower hello means restart" rule is removed. Core keeps its `seq` across restarts. A sender's clock never goes backwards and it sends nothing before its clock is set.
- Task states only move forward; the first final state stays. Late or contradicting reports change nothing.
- The Asset resends a Task's final report until Core acknowledges it with `admin.reply`, which now carries the `task_id`. Core resends a Task only while the Asset has never shown it holds it. An Asset never runs a `task_id` twice and remembers at least its last 1024 finished Tasks. The queue report includes the running Task.
- `control.cancel` never creates a Task. Core refuses an unknown or finished `task_id`. Cancelling a queued Task leaves the running one alone. A cancel that arrives before its Task is remembered.
- Settings: the connect report lists every supported setting; later reports may be partial, and a setting left out is unchanged. Per setting the newest `time` wins; an Asset never sends two settings reports with the same `time`.
- Link loss: contact means new messages from Core. New `admin.alive`, sent by Core when it has sent nothing new for a while. New setting `link_loss_after_s` (30 s unless set). With `link_loss_response: continue` the Asset keeps its Task and queue.

## 0.6

- Keys move from the link opening into the opening hello: `key` (and `enrollment_key` the first time) on `admin.hello`, `key` on `admin.operator_hello`. `key` is required on both. Keys appear in no other message, and Core never sends one: it shares an Asset's hello with operators as the new `admin.asset`, which has no key fields. New `hello_result` `refused`.
- The hello must come first. One link per ID: a newer link with the same `asset_id` or `operator_id` replaces the older.
- Everything a sender sends gets a new `seq`; Core puts its own `seq` on forwarded reports and on each `every_s` repeat.
- A query's `admin.reply` comes after its answer and marks the end; an accepted reply alone means nothing matched.
- Commands to an Asset that is not connected are refused.
- New setting `telemetry_every_s`.

## 0.5

- Operator API: one WebSocket per operator interface, same messages, pushed both ways. New `admin.operator_hello` and `operator_id`; the key travels with the link opening, like an asset key.
- `admin.hello_reply` names the Asset or the operator interface.
- New `admin.reply`: Core's `accepted` or `refused` (with `explanation`) to every operator message.
- Routing is the link's job. Receivers drop a repeated `(sender, seq)`.
- New example: operator session.

## 0.4

- Tasks carry `task_seq`. Assets wait (bounded) at a gap, then `query.queue`; a repeated `task_id` does nothing.
- `admin.hello` `commands` may be empty (receive-only Assets, such as an ADS-B receiver).
- An immediate motion command cancels the rest of the queue. Settings stay immediate.
- New `control.cancel`: stop a Task or the motion running now; the Asset holds and pauses.
- New command `return_to_home`. The failsafe response `return_home` is renamed `return_to_home`.
- Failsafe responses: `continue`, `hold`, `land`, `return_to_home`, `land_at`. New settings `low_battery_response` (no `continue`) and `land_at_position`.
- History: append-only log in storage, and `query.core` history for an Asset's past path.

## 0.3

- Nested message groups, query group, `hello` reports and commands, storage, cameras, observations and self-registration.
