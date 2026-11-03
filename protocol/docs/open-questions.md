# Open questions

Not decided yet. Planning comes before building.

A draft answer to several of these (envelope, acknowledgement, queue delivery,
version check, gateways) is in [communication.md](communication.md).

- **Message envelope.** Deferred: to be detailed later, when the details of how messages travel are nailed down.
  Messages like Takeoff will not be sent bare. They will be
  carried inside something that explains the context, for example a task list
  pushed to an Asset when it asks "what tasks do I have?".
- **Command acknowledgement.** How a command is acknowledged, keeping "accepted"
  separate from "observed result".
- **Queue and task-list delivery.** How an Asset's queued Tasks reach it.
- **Connect-time version check.** What the two ends exchange when they connect to
  confirm they run the same protocol. No handshake message exists yet.
- **Failure reporting.** A new Asset status, such as "return home active" or
  "link-loss response active", reported when it happens.
- **Objects.** One of the four pillars; no definitions yet.
- **Gateways.** Core talks to a gateway over IP through an API defined in the SDK.
  The gateway-to-Asset edge link is different, because of bandwidth limits.
- **Plugins.** Deferred; the system may be reimagined.
- **Encode/decode library and stress testing.** Build phase, after planning.
