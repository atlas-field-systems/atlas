# Findings

Protocol gaps found while building the prototype. Protocol is not changed from here.

## Settled in Protocol 0.6

1. **Link-opening format.** Keys go in the first message (`admin.hello`, `admin.operator_hello`), never the URL (law 17).
2. **Same operator_id twice.** One ID per interface; a newer link replaces the older (law 22).
3. **seq on forwarded messages.** Everything Core sends carries Core's own `seq`.
4. **Repeats versus duplicates.** Each `every_s` repeat gets a new `seq`.
5. **End of an answer.** A query's answer comes first and its `admin.reply` last; an empty answer is just the reply.
6. **Commands to a disconnected Asset.** Refused with a reason; nothing is held.
7. **Messages before hello.** The hello must be first or the link closes.
8. **A second link for the same Asset.** The newer link replaces the older (law 22).
9. **Telemetry rate.** Asset setting `telemetry_every_s`.
10. **Repeated task_id from an operator.** Core refuses it with a reason; the Asset ignores a resent Task silently.

## Still open (in Protocol's open-questions)

11. **Where operator keys come from.** The prototype reads them from config (`ATLAS_OPERATORS`).
12. **Bad messages from an Asset.** Dropped and logged; the Asset never knows.
13. **What "latest state" means on connect.** The prototype pushes each Asset's hello and newest report of each type.
14. **Storage formats.** The prototype stores whole messages as JSON beside a few key columns.

## Protocol 0.8 (SDK locks) — not adopted here yet

Protocol 0.8 documents the SDK how-it-works and cuts three prototype patches.
This Core still speaks its **pinned** Protocol release (see submodule) and still
implements the older shapes until a protocol-bump + adapt PR:

1. **Origin / no renumber.** Spec: every message carries `from`; Core forwards
   other creators unchanged; duplicates are `(from, seq, time)`; replies use
   `reply_from` + `reply_to`. Prototype today still stamps its own `seq` on
   forwards.
2. **`admin.describe` replaces `admin.asset`.** Hello is keys + version + id;
   description is keyless. Prototype still pushes `admin.asset`.
3. **No `task_seq` / gap-wait.** Core owns an ordered `task_id` list; Asset
   reports the queue; Core resends missing. Prototype may still pass `task_seq`
   through from operators.

**When the SDK exists:** Core calls shared `check()` and keeps business rules
only (online?, command listed in `admin.describe`?, duplicate `task_id`?). Core
keeps a last-answer cache for retries — **not** a second dedupe set that can
swallow them. Do not half-migrate the runtime ahead of the SDK thin slice.

See Protocol `sdk/how-it-works.md` and the 0.8 changelog section.

