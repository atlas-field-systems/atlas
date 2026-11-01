# Operating environment

## Story

I use Atlas for a flight lasting a few hours. Assets with adequate IP connectivity
can reach Core directly; other field links use a gateway. Links can disappear and
return while Atlas retains the run's records.

## Selected direction

- This is currently a short-run testing system. Keeping records until Reset is acceptable.
- Valid API keys have equal public-API permissions during this phase. Participants are trusted; a Plugin's intended role is not a credential restriction.
- Five seconds and one hour of disconnection use the same movement-request lifetime policy.
- Software updates may require Reset. Interrupted uploads may restart from zero. Core recovery may remain manual.
- Sensor-reference and uncertainty extensions remain deferred initially.

## Read a gateway-connected field link correctly

```mermaid
flowchart LR
    A[Asset] --> G[Gateway] --> C[Core receives a report]
    C --> R[Return path through gateway] --> A
```

A received report, the age of its measurements, and proven two-way contact are
different facts. Buffered telemetry must not imply current command reachability.

## Open

Contact proof, clock assumptions, and acceptable round-trip delays need a field-path
story. Behavior when the gateway is reachable but Core is not also needs a decision.

[Charter home](README.md)
