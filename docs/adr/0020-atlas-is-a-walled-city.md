---
status: accepted
date: 2026-11-26
---

# Atlas is a walled city

Atlas is laid out in rings. Core runs in one process inside the inner wall, built from pillars over shared storage and the event log. Plugins sit in the second ring: each is its own program that connects out to Core with its own key and reaches it only through the Plugin interface. Gateways, Assets, and operator applications sit outside and reach Core only through the public Core API.

Why: each ring can change without breaking the others, and Core never runs or calls code it does not own.

Rules: [The walled city](../../atlas/using-atlas.md#the-walled-city)
