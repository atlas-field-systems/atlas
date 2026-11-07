# First flight

The drone powers on and connects to Atlas through a gateway.
The operator sends the whole task list: Takeoff, Move To a location, then Land.
The drone starts the list only after it holds every Task's body.
The operator sees what the drone reports doing.

This is the selected first workflow. Takeoff and Land are planned capabilities,
not claims about the current implementation.

## The flight commands

- **Takeoff** has one input, a target altitude. The drone climbs straight up
  to it and holds there.
- **Move To** flies to a location.
- **Land** has a landing position and an optional transit altitude. The drone
  goes to that altitude, or stays at its current one, flies over the position,
  and lands.

These are simpler than MAVLink and ArduPilot commands but map onto them.

## Follow the work and its evidence

```mermaid
sequenceDiagram
    participant Drone
    participant Gateway
    participant Core
    participant App as Operator application
    Drone->>Gateway: Report identity and state
    Gateway->>Core: Forward the report
    Core-->>App: Show the reported state
    App->>Core: Send Takeoff, Move To and Land bodies, then their ordered list
    Core->>Gateway: Forward the bodies and list
    Gateway->>Drone: Deliver the bodies and list
    Drone-->>Gateway: Confirm the complete list is aboard
    Gateway-->>Core: Forward the queue report
    Core-->>App: Show the reported queue
    Note over Drone: Run Takeoff, Move To, then Land in order
    Drone-->>Gateway: Report what happened
    Gateway-->>Core: Forward the report
    Core-->>App: Show the reported outcome
    Note over Drone,App: Report each Task's progress and outcome
```

Core retains the requests and reported evidence. The Asset runtime performs the
physical action. A request reaching Core does not prove that the drone received
or executed it.

## When something goes wrong

The drone carries its whole task list before it leaves, so losing the link never
strands part of the mission on the ground. Any failure on the drone, a failed Task
included, triggers its configured failsafe. Unless that failsafe is set to
continue, the drone cancels the remaining Tasks, and Core marks them cancelled once
the drone reports it, so the records match what happened.

Each Asset has [settings](settings.md) for how it responds to events such as
losing its radio link. Each trigger has its own response: continue the mission,
hold, land, or return to home. Losing the link can be set to continue, for example
when Core rides in a car through a tunnel and the drone should keep its mission.
Return to home is done by an Atlas layer above the
flight controller or by ArduPilot's return-to-home mode.

Failure always wins. Every failure has a defined safe response, and it applies
whatever state the drone is in, including paused. An Asset never stays airborne
until it falls out of the sky.

## Keep the whole run for debugging

When the operator spins them down, Core, each gateway, and each Asset each
write their own Reset ZIP. Core's ZIP holds:

- Every message in and out, in local arrival and send order, with credentials removed.
- Each Task's history: what was requested, accepted, and observed.
- Each device's last state and each Track's history.
- The run setup: devices, gateways, settings, and software versions.
- Errors, link drops, and the SDK's message-handling diagnostics.
- A plain readable summary: start and end, devices, Tasks, and outcomes.

Reset ZIPs are for after the system is used: dump them into an AI agent to give
it full context on how the system was used and any errors. Each system's
documentation defines its own ZIP contents and Reset procedure. Merging
several ZIPs into one is a separate process.

Core and Assets keep detailed local diagnostic logs alongside their normal state.
The SDK supplies events to the program using it, so those events join that
program's archive. Logging does not depend on sending diagnostic traffic over
the field link. See [Core logging](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/logging.md),
[Asset logging](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/logging.md),
and [SDK logging](https://github.com/atlas-field-systems/atlas/blob/main/sdk/docs/logging.md).

This example explains one flight. Detailed Task, radio, and recovery rules
belong in their owning subsystem documentation.

[Charter home](README.md)
