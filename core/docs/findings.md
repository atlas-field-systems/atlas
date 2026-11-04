# Findings

Protocol gaps and questions found while building the prototype. Not decided; Protocol is not changed from here. Each says what the prototype does for now.

1. **Link-opening format.** Protocol says keys travel with the link opening but not how. Browsers cannot set WebSocket headers, so the prototype uses the query string (`/asset?asset_id=&key=&enrollment_key=`, `/operator?operator_id=&key=`). Keys in URLs can end up in logs.
2. **Where operator keys come from.** Assets self-enroll; nothing says how an operator ID and key are created. The prototype reads them from config (`ATLAS_OPERATORS`).
3. **Same operator_id twice.** Two interfaces with one `operator_id` share one `seq` space, so the duplicate rule drops messages from the second. Is it one ID per interface, enforced?
4. **seq on forwarded messages.** Core forwards Asset reports unchanged, so one operator link carries Core's `seq` plus each Asset's. Gaps per link cannot be seen, and an operator-side duplicate check needs `(asset_id, seq)` for forwarded reports.
5. **Repeats versus duplicates.** `query.asset` with `every_s` re-sends Core's latest copy. If the report has not changed, it is the same `(sender, seq)`, which the duplicate rule says to drop.
6. **End of an answer.** A `query.core` history answer is a run of messages with no end marker, so an interface cannot tell "done" or "empty" from "still coming".
7. **Commands to a disconnected Asset.** Refused for now ("A1 is not connected"). Should Core hold Tasks and deliver them on reconnect?
8. **Repeated task_id from an operator.** The Asset ignores a repeat silently; Core refuses it with a reason. Is that the intended split?
9. **Bad messages from an Asset.** There is no reply to Assets, so an invalid report is dropped and logged and the Asset never knows.
10. **Messages before hello.** Undefined. The prototype drops them from an Asset and closes an operator link.
11. **A second link for the same Asset.** The prototype closes the older socket. The duplicate rule covers two live links, but which one Core sends on is undefined.
12. **What "latest state" means on connect.** The prototype pushes each Asset's hello and its newest report of each type (and status kind). Is the queue part of it, and is there a "connected" or "stale" flag?
13. **Storage formats.** Tables exist but column formats do not. The prototype stores whole messages as JSON beside a few key columns.
14. **Telemetry rate.** Nothing says how often an Asset sends telemetry while flying. The simulation sends it twice a second (scaled by its speed).
