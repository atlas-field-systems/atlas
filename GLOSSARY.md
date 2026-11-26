# Atlas

Atlas helps operators understand field systems, request work, and retain evidence.

## Language

### Reset and identity

**Reset**:
Stopping Core. Core writes its **Reset ZIP**, checks it, and clears the **Shared picture**. A Core crash is not a **Reset**. [The picture and Reset](atlas/reset-and-identity.md#the-picture-and-reset)

**Registration**:
An **Asset** joining the **Shared picture** and receiving its Asset ID from Core. [Keys and registration](atlas/reset-and-identity.md#keys-and-registration)
_Avoid_: Sign-up

**Provisioning**:
Admin setup that carries across a **Reset**, including adding or removing accounts and connection keys for **Assets** on IP, **Gateways**, and **Plugins**. [What carries over](atlas/reset-and-identity.md#what-carries-over)

**Reset ZIP**:
One part's file dump, written at **Reset** or at the end of an operation, for people and AI agents to investigate. Core, each **Asset**, and each **Gateway** write their own. [Core Reset](core/docs/reset.md)

**Radio identity**:
A radio's own identity, established by its field link's cryptography and kept by its **Gateway** and **Fieldlink**. [What every Fieldlink provides](fieldlink/README.md#what-every-fieldlink-provides)
_Avoid_: Core key for a radio's identity

**Contact**:
Core's view of whether an **Asset** or **Gateway** is online or offline, when Core last heard from it, and for an **Asset** on IP whether its command stream can accept commands. [Contact](core/docs/api.md#contact)

### The picture

**Event log**:
Core's append-only log of accepted requests and **Asset** reports in order. Readers use it for live updates and history. [Core storage](core/docs/storage.md)

**Shared picture**:
The field state held by the Entities **Pillar** and shown on the Command Interface map, including **Assets**, **Observations**, and **Geo features**. Entries stay until changed or removed, or until the next **Reset**. [Entities](core/docs/api.md#entities)

**Observation**:
One **Asset**'s latest report of what it sees of one target, identified by that Asset and the observation ID it chose. [Observations](core/docs/api.md#observations)
_Avoid_: Sighting (operator-facing label)

**Geo feature**:
A point, line, area, or **Imagery** on the map, with an optional name. Operators and admins can create, change, and delete **Geo features**, and **Plugins** and **Assets** can create them. [Geo features](core/docs/api.md#geo-features)
_Avoid_: Place (operator-facing label)

**Imagery**:
A **Geo feature** that shows one GeoTIFF **Object** at the location the file specifies. Only its name can be edited. [Geo features](core/docs/api.md#geo-features)

**View filter**:
An operator's choice to hide items from their own view, such as old **Observations**. It is private to one browser, ends at **Reset**, and leaves the **Shared picture** unchanged. [View filters](command-interface/docs/README.md#hide-items-in-your-own-view)

### Work

**Command**:
A request to perform a supported action, such as Takeoff or Land.

**Task**:
One piece of requested work with a reported outcome.

**Outcome unknown**:
The state shown for a dropped **Task** or unanswered request when contact ends or an **Asset** restarts, because the work may have run before contact ended. Resending is the operator's choice. [ADR-0024](docs/adr/0024-dropped-work-shows-outcome-unknown-never-resumed-or-reconciled.md)
_Avoid_: Not done (for a dropped Task)

**Request body**:
What an operator sends to Core to ask for work or a settings change. Core uses it to make a record. [Protocol laws](protocol/docs/laws.md)

**Capture**:
A **Task** that asks a camera for a photo or clip. [Capture files](asset/docs/README.md#capture-files)

**Supported setting**:
A setting an **Asset** lists in its description, whether or not the current value is known. [Asset settings](asset/docs/README.md)

**Pause**:
A setting that stops an **Asset**'s movement in place. The current **Task** stays active and continues when the **Asset** is set running again. [Pause](asset/docs/README.md#pause)

**Hold**:
A **Command** that stops an **Asset** where it is and holds it there. It keeps no earlier work to resume. [Hold](asset/docs/README.md#pause)

### Failsafes

**Subsystem**:
A declared part of an **Asset** with its own **Subsystem condition**, such as a GPS receiver, camera, or equipment software component. [Subsystem conditions](asset/docs/status.md)

**Subsystem condition**:
The reported health of one **Subsystem**. Its values are unknown, healthy, degraded, or faulted. [Subsystem conditions](asset/docs/status.md)

**Failsafe policy**:
An **Asset**'s complete set of **Failsafe rules**, configured and replaced as one setting. [Failsafes](asset/docs/failsafes.md)

**Failsafe condition**:
A test of an **Asset**'s equipment, **Contact**, or work state, used in a **Failsafe rule**.

**Failsafe rule**:
A rule identified by its rule ID, with **Failsafe conditions**, a priority, and a configured **Failsafe response**. [Failsafes](asset/docs/failsafes.md#configure-conditions-as-well-as-responses)

**Failsafe response**:
A supported **Command** with its parameters, run once each time its **Failsafe rule** fires. The response always stops ordinary work. [Failsafe responses](asset/docs/failsafes.md#a-failsafe-activates-a-configured-task)

**Failsafe task**:
One local execution of a **Failsafe response** using the ordinary **Task** path. Its **Failsafe rule** and start time identify it. [Failsafe tasks](asset/docs/failsafes.md#a-failsafe-activates-a-configured-task)

**Failsafe state**:
An **Asset**'s lock on ordinary work for the rest of its operation. A **Failsafe rule**, the operator's Fail-safe **Command**, or the flight controller taking over starts it. [Lock ordinary work](asset/docs/failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation)

### Plugins and Objects

**Object**:
A file held by Core, separate from Entities, with a description and an optional attachment to one **Geo feature**. Operators, **Plugins**, and **Assets** can add **Objects**, and a different file is a new **Object**. [Objects](core/docs/api.md#objects)

**Plugin**:
A program running beside Core that offers **Plugin actions** and connects with its own key through the **Plugin interface**. It cannot direct **Assets**. [Plugins](atlas/plugins.md)

**Plugin interface**:
The part of the Core API available to a **Plugin** through its key. [Plugins](core/docs/api.md#plugins)

**Plugin action**:
One thing a **Plugin** offers to do, such as finding the buildings in an area. The **Plugin** describes the action and its inputs using Protocol's common pieces. [Plugins](atlas/plugins.md)

**Plugin call**:
One execution of a **Plugin action** with its inputs. It ends with a result or failure, or is dropped if the **Plugin** goes offline or is removed first. [Plugins](core/docs/api.md#plugins)

**Result overlay**:
A **Plugin**'s listed results drawn privately on one operator's map. The operator can share an item by saving it as a **Geo feature**. [Plugin results](command-interface/docs/plugins-and-objects.md#run-a-plugin)

### Parts and links

**Asset**:
An Atlas participant that reports information and may offer equipment control.

**Gateway**:
A system on its own computer that connects Core to one field radio network through a **Fieldlink**. Each network has one **Gateway**, and Core can serve several. [Gateway](gateway/README.md)

**Gateway app**:
The framework every **Gateway** runs to connect to Core and register the **Assets** its radio hears. It installs **Fieldlinks** and runs one at a time through its stable gateway interface. [Gateway](gateway/README.md)

**Fieldlink**:
A separately released package that carries Atlas over one kind of field link, defined by its radio hardware and software. It holds both a **Gateway** side and an **Asset** side. [Fieldlink](fieldlink/README.md)

**Atlas Tool**:
A ready setup that packages existing Atlas parts with the glue for one kind of equipment, such as the SiK tool for first flight. It carries no Atlas messages over a field link, and no part depends on it. [Atlas Tools](tools/README.md)
_Avoid_: Fieldlink, for a radio that carries only a vehicle's own protocol

**Pillar**:
A part of Core that owns one share of its state behind a small interface, such as Entities, **Tasks**, or **Objects**. [Core pillars](core/docs/pillars.md)

**Simulation**:
A test of an end-to-end rule using real Atlas parts with simulated links, **Assets**, time, and faults. Its results apply to the simulated world. [Simulations](simulations/README.md)

### Asset software

**Asset module**:
A part of the **Asset** app that owns a behavior, such as communications or platform movement.

**Equipment driver**:
A part of an **Asset** that talks to external equipment to read its state, control it, or both. [Modules and equipment drivers](asset/docs/assets.md#modules-and-equipment-drivers)
_Avoid_: Driver

**Communications module**:
The **Asset module** that manages the SDK and routes Atlas requests and reports. [Communications](asset/docs/communications.md)

**Movement module**:
The **Asset module** that carries out **Commands** to physically move the platform. [Movement module and profiles](asset/docs/assets.md#movement-module-and-profiles)

**Movement profile**:
Platform-specific behavior and parameters used by a **Movement module**. [Movement module and profiles](asset/docs/assets.md#movement-module-and-profiles)
_Avoid_: Autopilot flight mode
