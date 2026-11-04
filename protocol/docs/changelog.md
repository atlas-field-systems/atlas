# Changelog

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
