# First flight

## Story

The drone powers on, connects to Atlas through a gateway, and identifies itself.
I request Takeoff, then Move To a location, then Land, and see its reported outcomes.

This is the selected first workflow. Takeoff and Land are planned capabilities,
not claims about the current implementation.

## Flow

```mermaid
sequenceDiagram
    participant Drone
    participant Gateway
    participant Core
    actor Operator
    Drone->>Gateway: Identify and report
    Gateway->>Core: Forward the report
    Operator->>Core: Request Takeoff
    Core->>Gateway: Make the request available
    Gateway->>Drone: Deliver the request
    Drone-->>Core: Report execution through the gateway
    Operator->>Core: Request Move To after Takeoff succeeds
    Drone-->>Core: Report movement and outcome through the gateway
    Operator->>Core: Request Land after Move To succeeds
    Drone-->>Core: Report landing outcome through the gateway
```

## What the story must make visible

- Connection keeps the Asset identity; received telemetry and two-way contact are distinct.
- Atlas retains requests. The Asset supplies evidence of actual execution.
- Ordinary telemetry supplies current state and three-dimensional history without a second reporting API.
- Losing a link or reply does not authorize repeating uncertain work.

After the flight, the [Reset story](operations.md) covers producing its archive.
Preloaded queues, camera concurrency, and Plugin jobs are separate stories; this
first sequence does not select their mechanisms.

[Charter home](README.md)
