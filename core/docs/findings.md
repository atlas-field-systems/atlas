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

## Still open (in Protocol's open-questions)

10. **Where operator keys come from.** The prototype reads them from config (`ATLAS_OPERATORS`).
11. **Repeated task_id from an operator.** The Asset ignores a repeat silently; Core refuses it with a reason.
12. **Bad messages from an Asset.** Dropped and logged; the Asset never knows.
13. **What "latest state" means on connect.** The prototype pushes each Asset's hello and newest report of each type.
14. **Storage formats.** The prototype stores whole messages as JSON beside a few key columns.
