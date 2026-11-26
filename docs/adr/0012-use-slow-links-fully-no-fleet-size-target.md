---
status: superseded by ADR-0021
date: 2026-11-14
---

# Use slow links fully; no fleet-size target

On slow links such as LoRa, airtime is scarce. Atlas uses all available airtime whenever useful data is waiting and spends it on the highest-priority data first.

Atlas has no fleet-size target. For every field link, measured capacity decides how many Assets it carries. The early rough guess of about 20 Assets is neither a fleet target nor a pass bar.

Rules: [Fleet](../../atlas/scale.md#fleet), [Operator deadlines come first](../../atlas/scale.md#operator-deadlines-come-first)
