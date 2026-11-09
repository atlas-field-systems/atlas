# First flight

The first setup uses a Raspberry Pi on the ground. The Pi runs the Asset app and
reaches Core through a gateway; the gateway's details are deferred. The Pi
connects to an ArduPilot quadcopter through a SiK radio link. It acts as the
companion computer from the ground, much like using a ground-control station
such as QGroundControl. The vehicle remains the Asset represented in Atlas.

The operator submits Takeoff, Move To a location, then Land as Tasks through the
Command Interface. Core assigns each `task_id` and sends the Asset its queue
whole: its version and every Task body together. The app sends equipment commands
to the flight controller and reports the observed outcomes. The operator sees the
reported vehicle behavior.

No runtime is built yet. The Pi can reach Core while vehicle equipment is still
starting or unreachable. Connection alone does not establish takeoff readiness.
The operator can intervene locally at the Pi. Independent vehicle controls and
ArduPilot protections remain part of the setup, with their configuration and
handover procedure still to be defined and verified.

## The flight commands

- **Takeoff** has one input, a target altitude. The drone climbs straight up
  to it and holds there.
- **Move To** flies to a location.
- **Land** has a landing position and an optional transit altitude. The drone
  goes to that altitude, or stays at its current one, flies over the position,
  and lands.

These are the copter commands. Fixed-wing aircraft need a separate command
family with its own behavior. The copter commands are simpler than MAVLink and
ArduPilot commands but map onto them.
The Asset owns [platform-specific preparation and arming](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#prepare-and-take-off).

## Follow the work and its evidence

```mermaid
sequenceDiagram
    participant Drone as ArduPilot vehicle
    participant Pi as Asset app on ground Pi
    participant GW as Gateway
    participant Core
    participant UI as Command Interface
    Drone->>Pi: Equipment state over SiK
    Pi->>GW: Description and vehicle reports
    GW->>Core: Reports through the Core API
    Core-->>UI: Show the reported state
    UI->>Core: Submit Takeoff, Move To and Land as Tasks
    Core->>GW: The whole queue with every Task body
    GW->>Pi: Deliver the queue
    Pi-->>GW: Report the queue it holds
    GW-->>Core: Queue report
    Core-->>UI: Show the reported queue
    Note over Pi: Run Takeoff, Move To, then Land in order
    Pi->>Drone: Equipment commands over SiK
    Drone-->>Pi: Observed equipment state over SiK
    Pi-->>GW: Task reports
    GW-->>Core: Task reports
    Core-->>UI: Show the reported outcomes
```

Core keeps the requests and the reported evidence in its event log. The Asset app
coordinates execution, and ArduPilot controls the vehicle. Core accepting a Task,
or the Pi holding it, does not prove that the flight controller received or
executed an equipment command. Task states change only from the Asset's reports.
The SiK connection is an equipment link, not an Atlas field link.

## When something goes wrong

The ground Pi holds the Atlas queue. Whether it uploads a complete mission
to the flight controller remains open. Continued flight after SiK loss cannot
assume an onboard Atlas queue.

If the link to Core drops but the Pi and SiK link keep working, the app retains
its queue and execution state. Configured Atlas failsafe conditions determine its
response. If SiK drops, the Pi may still report to Core, but it lacks current
vehicle evidence and cannot rely on sending a response to the flight controller.
Independent controller protections and the operator's intervention path handle
the failures they are configured to cover, including failure of the Pi itself.

A command failure cancels the remaining Tasks. For example, failed Takeoff
cancels Move To and Land. Core records cancellations when the app reports them.
Detected independent autopilot failsafe takeover also cancels ordinary work and
locks it for the operation. No configured response preserves cancelled Tasks.

Atlas [settings](settings.md) configure local conditions and response Tasks.
A response uses the same equipment execution as ordinary work. Return to home
can use Atlas execution or ArduPilot's own behavior, as selected for the setup.
A requested response is not proof that the vehicle returned or landed.

An applicable failsafe overrides ordinary work, including paused, and locks new
work for the rest of the operation, even after its response Task succeeds.
During a failsafe the operator can still override it with an immediate Land or
Return to home, or with pause. The Asset records each as an override.
Local intervention and a manual restart of the app on the ground Pi are required
before another operation. Atlas does not manage that recovery. The system is spun
down and the failure is evaluated from the Reset ZIPs.
Atlas enables no failsafe rules by default. The flight setup explicitly supplies
the intended rules, including any battery response during an intentional wait.
The Asset owns
[the trigger conditions, cancellation rule, overrides, and remaining decisions](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md).

## Keep the whole run for debugging

When the operator spins them down, Core, each gateway, and each Asset each
write their own Reset ZIP. Core's ZIP holds:

- Its event log: every accepted request and every stored report, in order.
- Its diagnostics, such as errors, link drops, and contact changes.
- Its configuration, without secrets.
- A plain readable summary: start and end, Assets, Tasks, and outcomes.

Reset ZIPs are for after the system is used: dump them into an AI agent to give
it full context on how the system was used and any errors. Each system's
documentation defines its own ZIP contents and Reset procedure. Merging
several ZIPs into one is a separate process.

Core, gateways, and Assets keep detailed local diagnostic logs alongside their
normal state. The SDK supplies events to the program using it, so those events
join that program's archive. Logging does not depend on sending diagnostic
traffic over the field link. See
[Core logging](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/logging.md)
and [Asset logging](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/logging.md).

This example explains one flight. Detailed Task, field-link, and recovery rules
belong in their owning subsystem documentation.

[Charter home](README.md)
