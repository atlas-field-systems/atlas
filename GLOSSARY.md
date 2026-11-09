# Atlas language

Behavior belongs to the owning subsystem; shared formats belong to Protocol.

| Term | Meaning |
| --- | --- |
| Asset | An Atlas participant that reports information and may offer equipment-control capabilities. |
| Gateway | A system outside Core that uplinks to the Core API and carries Atlas across field links using Fieldlinks. A gateway is not an Asset. |
| Fieldlink | A package that carries Atlas over one kind of field link, such as Meshtastic LoRa. The same package runs on the gateway and on the radio Asset. |
| Event log | Core's ordered record of accepted requests and Asset reports. Current state, live updates, and history are read from it. |
| Asset module | A part of the Asset app that owns a behavior, such as communications or platform movement. |
| Equipment driver | A part of an Asset that talks to external equipment to acquire state, control it, or both. Use the full term. |
| Communications module | The Asset module that manages the SDK and routes Atlas requests and reports. |
| Movement module | The Asset module that carries out commands for physical platform movement. |
| Movement profile | Platform-specific execution behavior and parameters used by a movement module, distinct from an autopilot flight mode. |
| Command | A request to perform a supported action, such as Takeoff or Land. |
| Task | One instance of requested work with a reported execution outcome. |
| Failsafe condition | A test of an Asset's equipment, contact, or work state. |
| Failsafe rule | Conditions, a priority, and a configured response. |
| Failsafe response | A reusable action and its parameters. |
| Failsafe task | One locally started execution of a configured response, using ordinary Task execution. |
| Failsafe state | The Asset's [operation-long lock on ordinary work](asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation). |
