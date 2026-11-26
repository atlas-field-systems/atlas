---
status: accepted
date: 2026-11-25
---

# Operator deadlines come first, then telemetry fills the link

An operator sees a command start, and sees an Asset go offline, within about 10 s and never more than 15 s. On a slow link such as LoRa, commands, the Task-started report, and contact proof go first. Telemetry fills only the airtime left over, so a busy channel never makes a command wait behind telemetry.

Atlas still has no fleet-size target. A field link carries as many Assets as still meet those times. The early rough guess of about 20 Assets is neither a fleet target nor a pass bar.

Why: ADR-0012 filled every bit of airtime, which could keep a channel full, so a command or a sign of life waited behind telemetry. The operator's deadlines are the point of the link; spare airtime is not.

Supersedes ADR-0012.

Rules: [Fleet](../../atlas/scale.md#fleet), [Operator deadlines come first](../../atlas/scale.md#operator-deadlines-come-first)
