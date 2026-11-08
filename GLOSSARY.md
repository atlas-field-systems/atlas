# Atlas language

Behavior belongs to the owning subsystem; shared formats belong to Protocol.

| Term | Meaning |
| --- | --- |
| Asset | An Atlas participant that reports information and may offer equipment-control capabilities. |
| Command | A request to perform a supported action, such as Takeoff or Land. |
| Task | One instance of requested work with a reported execution outcome. |
| Failsafe condition | A test of an Asset's equipment, contact, or work state. |
| Failsafe rule | Conditions, a priority, and a configured response. |
| Failsafe response | A reusable action and its parameters. |
| Failsafe task | One locally started execution of a configured response, using ordinary Task execution. |
| Failsafe state | The Asset's [operation-long lock on ordinary work](asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation). |
