---
status: proposed
date: 2026-11-25
---

# Atlas is a walled city

Atlas is laid out in rings. Core and Fusion run in one process inside the inner wall, and Fusion works on Core's state directly. Plugins sit in the second ring: each is its own program that connects out to Core with its own key and reaches it only through the Plugin interface. Gateways, Assets, and operator applications sit outside and reach Core only through the public Core API.

Why: each ring can change without breaking the others, and Core never runs or calls code it does not own.

Moved here when the old project-wide choices page was split up. The owner has not yet decided it as an ADR.

Rules: [The walled city](../../atlas/using-atlas.md#the-walled-city)
