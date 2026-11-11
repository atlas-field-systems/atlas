# Atlas language

Behavior belongs to the owning subsystem; shared formats belong to Protocol.

| Term | Meaning |
| --- | --- |
| Asset | An Atlas participant that reports information and may offer equipment-control capabilities. |
| Gateway | A system on its own computer, outside Core, that uplinks to the Core API and carries Atlas across field links using Fieldlinks. A site runs one gateway at a time, and each radio Asset is carried by that gateway. Core authenticates the gateway; the Assets it carries authenticate to it. A gateway is not an Asset. |
| Fieldlink | A package that carries Atlas over one kind of field link, such as Meshtastic LoRa. It is installed on the gateway app, and the same package runs on the radio Asset. See [Gateway](gateway/README.md). |
| Radio identity | The identity one radio has on its field link, made with that link's own cryptography, such as a Meshtastic node's public key. It is public, not a secret. Only the radio that holds it can speak as its Asset. |
| Pillar | A part of Core that owns one share of its state behind a small interface, such as Entities, Tasks, or Objects. See [Core pillars](core/docs/pillars.md). |
| Event log | Core's append-only `events` table: every accepted request and Asset report, in order. Live updates and history are read from it; current state lives in ordinary tables. |
| Asset module | A part of the Asset app that owns a behavior, such as communications or platform movement. |
| Equipment driver | A part of an Asset that talks to external equipment to acquire state, control it, or both. Use the full term. |
| Communications module | The Asset module that manages the SDK and routes Atlas requests and reports. |
| Movement module | The Asset module that carries out commands for physical platform movement. |
| Movement profile | Platform-specific execution behavior and parameters used by a movement module, distinct from an autopilot flight mode. |
| Command | A request to perform a supported action, such as Takeoff or Land. |
| Request body | What an operator sends to Core to ask for work or a settings change. It is not a record: Core adds the time, the IDs, and who asked to make the record. |
| Supported setting | A setting an Asset lists in its description. Supporting a setting is separate from knowing its current value. |
| Pause | A setting that holds an Asset in place. The active Task stays active and continues when the Asset is set running again. |
| Contact | Whether Core is hearing from an Asset or gateway (online) or not (offline), with the time it was last heard. Contact is not proof of two-way communication. |
| Provisioning | Adding an Asset or gateway to Core, or removing it, done by an admin, or by a gateway for a radio Core has never seen. |
| Task | One instance of requested work with a reported execution outcome. |
| Failsafe condition | A test of an Asset's equipment, contact, or work state. |
| Failsafe rule | Conditions, a priority, and a configured response. |
| Failsafe response | A reusable action and its parameters. |
| Failsafe task | One locally started execution of a configured response, using ordinary Task execution. |
| Failsafe state | The Asset's [operation-long lock on ordinary work](asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation). |
