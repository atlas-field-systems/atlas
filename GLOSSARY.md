# Atlas language

Behavior belongs to the owning subsystem; shared formats belong to Protocol.

| Term | Meaning |
| --- | --- |
| Asset | An Atlas participant that reports information and may offer equipment-control capabilities. |
| Gateway | A system on its own computer, outside Core, that uplinks to the Core API and carries Atlas across field links using Fieldlinks. A site runs one gateway at a time. A gateway is not an Asset. See [Gateway](gateway/README.md). |
| Gateway app | The framework every gateway runs. It connects to Core, registers the Assets its radio hears, and runs one Fieldlink. See [Gateway](gateway/README.md). |
| Fieldlink | A separately released package installed on the gateway app as its operating mode, defined by its radio hardware and the software over it, such as SiK with MAVLink or LoRa with Meshtastic. It either carries Atlas to an Asset running the same package, or runs the Asset app on the gateway for a vehicle that runs no Atlas software. A gateway runs one at a time. See [Gateway](gateway/README.md#fieldlinks-are-the-gateways-operating-modes). |
| Radio identity | The identity one radio has on its field link, made with that link's own cryptography, such as a Meshtastic node's public key. It stays with the gateway and its Fieldlink; Core does not hold it. See [what every Fieldlink provides](gateway/README.md#what-every-fieldlink-provides). |
| Run | Everything between one start of Core and the next deliberate stop. A crash of Core resumes the run. See [Runs and identity](atlas/runs-and-identity.md). |
| Registration | An Asset joining the current run and getting its `asset_id` from Core. See [Runs and identity](atlas/runs-and-identity.md#keys-and-registration). |
| Reset | Ending a run by stopping Core on purpose. There is no Reset request or button. See [Runs and identity](atlas/runs-and-identity.md#a-run-and-reset). |
| Reset ZIP | One part's own archive of a run or operation, for people and AI agents to investigate it. Core, each Asset, and each gateway write their own. See [Core Reset](core/docs/reset.md). |
| Pillar | A part of Core that owns one share of its state behind a small interface, such as Entities, Tasks, or Objects. See [Core pillars](core/docs/pillars.md). |
| Event log | Core's append-only `events` table: every accepted request and Asset report, in order. Live updates and history are read from it; current state lives in ordinary tables. |
| Shared picture | Everything the Entities pillar holds about the field: Assets, Observations, Tracks, and geo features. The Command Interface draws its map from it. Nothing in it expires during a run. |
| Observation | What one Asset currently reports seeing of one target, named by the Asset and its own `observation_id`. Evidence, not a conclusion. Operators may call it a sighting. |
| Track | Fusion's conclusion about one target, resting on one or more Observations. Only Fusion creates, changes, or removes one. |
| Geo feature | A place on the map: a point, line, area, or imagery, with an optional name. Operators and admins create, change, and delete them; Plugins and Assets may create them. Operators may call it a place. |
| Imagery | A geo feature that shows one GeoTIFF Object on the map, where the file says it belongs. It can only be renamed. See [geo features](core/docs/api.md#geo-features). |
| Object | A file Core holds, with a description of what it is. An Object never changes; a different file is a new Object. Operators, Plugins, and Assets add Objects. It may be attached to one geo feature. Objects are not Entities. |
| Plugin | A program beside Core, in the second ring, that offers actions. It connects out to Core with its own key and reaches Core only through its Plugin interface. Plugins do not direct Assets. See [Plugins](atlas/plugins.md). |
| Plugin interface | The Core API calls a Plugin's key may use. |
| Plugin action | One thing a Plugin offers to do, such as find the buildings in an area. The Plugin describes it and its inputs, built from Protocol's common pieces; Protocol does not list actions. |
| Plugin call | One run of a Plugin action with its inputs. It ends with a result or a failure, or is dropped if the Plugin goes offline or is removed first. |
| View filter | An operator's choice to hide items in their own view, such as old sightings or a Track they disagree with. It belongs to one browser and one run, never changes the shared picture, and other operators never see it. |
| Result overlay | A Plugin's listed results drawn on one operator's map. It never enters the shared picture; the operator saves an item as a place to share it. |
| Asset module | A part of the Asset app that owns a behavior, such as communications or platform movement. |
| Equipment driver | A part of an Asset that talks to external equipment to acquire state, control it, or both. Use the full term. |
| Communications module | The Asset module that manages the SDK and routes Atlas requests and reports. |
| Movement module | The Asset module that carries out commands for physical platform movement. |
| Movement profile | Platform-specific execution behavior and parameters used by a movement module, distinct from an autopilot flight mode. |
| Command | A request to perform a supported action, such as Takeoff or Land. |
| Request body | What an operator sends to Core to ask for work or a settings change. It is not a record: Core adds the time, the IDs, and who asked to make the record. |
| Supported setting | A setting an Asset lists in its description. Supporting a setting is separate from knowing its current value. |
| Pause | A setting that stops an Asset's movement in place. The active Task stays active and continues when the Asset is set running again. Pause is not Hold. See [pause](asset/docs/README.md#pause). |
| Contact | Whether Core is hearing from an Asset or gateway (online) or not (offline), with the time it was last heard. Contact is not proof of two-way communication. |
| Provisioning | An admin adding or removing an account, or the key of an Asset on IP, a gateway, or a Plugin. Provisioning carries across runs; Assets themselves join by [registration](atlas/runs-and-identity.md#keys-and-registration). |
| Task | One instance of requested work with a reported execution outcome. |
| Hold | A command, like Land, that stops an Asset where it is and keeps it there. It keeps no earlier work to resume, so it is not pause. |
| Subsystem | A part of an Asset, hardware or equipment software, that the Asset declares and reports a condition for, such as a GPS receiver or camera. |
| Subsystem condition | A subsystem's health: unknown, healthy, degraded, or faulted. Not a failsafe condition. There is no overall Asset condition. |
| Failsafe policy | An Asset's complete list of failsafe rules. It is one setting, always replaced whole. |
| Failsafe condition | A test of an Asset's equipment, contact, or work state, used in a failsafe rule. |
| Failsafe rule | Conditions, a priority, and a configured response, named by its rule ID. |
| Failsafe response | A command the Asset supports and its parameters. It runs once each time its rule fires; only a critical battery rule falls back, to Return to home. A response always stops ordinary work; an Asset that should keep working has no rule for that situation. |
| Failsafe task | One locally started execution of a failsafe response, using ordinary Task execution. It has no Core task number; its rule and start time name it. |
| Failsafe state | The Asset's [operation-long lock on ordinary work](asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation). A rule or the operator's Fail-safe command starts it. |
