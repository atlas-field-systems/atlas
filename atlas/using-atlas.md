# Using Atlas

An operator application shows field information and lets a person request work.
Core holds the shared picture and the requests. A gateway carries traffic across
the field link. The Asset runtime controls its equipment and reports what happened.

## The usual field path

```mermaid
flowchart TD
    subgraph Core
        C[Shared state and requests]
        P[Plugin subsystem] <--> C
    end
    U[Operator application] <-->|IP| C
    C <-->|IP| G[Gateway]
    G <-->|Available field links| A[Physical Asset runtime and equipment]
    D[Direct-IP Asset, often digital] <-->|IP| C
```

The direct-IP path is available. Most physical Assets use the gateway path.
Applications and gateways can use an SDK or the public API.
The gateway represents the implementation used for that field link. Different
gateway implementations can coexist as [connectivity evolves](environment.md#connectivity-evolves).
The diagram shows system responsibilities, not process boundaries, wire messages,
or a required network topology.

## What the parts do

| Part | Responsibility |
| --- | --- |
| Operator application | Human interaction and presentation |
| Protocol and SDK | Shared contracts and client access |
| Core | Shared state, retained evidence, and requests for work |
| Gateway | Translation and forwarding across the field link |
| Asset runtime | Equipment control, local execution, and reports of its effects |
| Plugin subsystem within Core | Acquiring, analyzing, and publishing information |

The Asset runtime is planned in [asset](https://github.com/atlas-field-systems/asset)
and the operator application in
[command-interface](https://github.com/atlas-field-systems/command-interface).

## The four pillars

Entities describe Assets, their Observations, shared Tracks, and authored Geofeatures.
Tasks describe requested work and reported outcomes.
Objects hold files and their metadata.
[Plugins](plugins.md) run inside Core and offer actions, such as finding every
building in an area. They do not control Assets.

Core runs in Docker as a set of modules, such as the API and data storage.
One module is the Plugins module. Plugins are small and run inside it.
Core starts before any other part of an operation and stops after all of them,
so the parts are not designed for Core restarting mid-operation.
An Asset's [settings](settings.md) are its current configuration, kept in its entry.

Each subsystem's documentation defines its behavior. Authentication and
administration support the pillars.

## Information-focused stories

These stories describe intended use.

### Observe an aircraft

An ADS-B receiver is an Asset. It reports Observations about a passing aircraft.
Atlas uses those Observations as evidence to maintain a shared Track of the
aircraft for the operator to follow. The operator does not need to control that
aircraft to observe it through Atlas.

### Research a place

An operator selects a building or area and runs a Plugin action on it. The Plugin
returns a list, or publishes its findings through Entities and any files through
Objects. [Plugins](plugins.md) has the examples.

[First flight](first-flight.md) follows one complete use of these parts.
