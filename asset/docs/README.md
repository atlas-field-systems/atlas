# Asset docs

How an Asset behaves. Nothing is written here yet.

Until it is, the Asset's rules are in Protocol's [How Atlas parts communicate](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md), mostly these sections:

- [Opening a connection (Asset)](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md#opening-a-connection-asset)
- [Delivering a task queue](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md#delivering-a-task-queue)
- [Settings](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md#settings)
- [Losing the link](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md#losing-the-link)
- [After reconnecting (Asset)](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/communication.md#after-reconnecting-asset)

Rules that only an Asset follows move here as they settle.

Open: any failure on the Asset triggers its configured failsafe, but what triggers
which failsafe is the Asset's call and not decided yet.
