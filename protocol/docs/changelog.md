# Changelog

## 0.4

- Tasks carry `task_seq`. Assets wait (bounded) at a gap, then `query.queue`; a repeated `task_id` does nothing.
- `admin.hello` `commands` may be empty (receive-only Assets, such as an ADS-B receiver).
- An immediate motion command cancels the rest of the queue. Settings stay immediate.
- New `control.cancel`: stop a Task or the motion running now; the Asset holds and pauses.
- New command `return_to_home`. The failsafe response `return_home` is renamed `return_to_home`.
- Failsafe responses: `continue`, `hold`, `land`, `return_to_home`, `land_at`. New settings `low_battery_response` and `land_at_position`.
- History: append-only log in storage, and `query.core` history for an Asset's past path.

## 0.3

- Nested message groups, query group, `hello` reports and commands, storage, cameras, observations and self-registration.
