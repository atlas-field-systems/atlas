---
status: accepted
date: 2026-11-13
---

# Build each part whole, one part at a time

Atlas builds each part whole, one part at a time, so each part can use what the last one taught. The first version builds Protocol, then Core, then the SDK, with simulations that test them together. Core's build started without waiting for a simulator prototype. For example, Core's Entities, Tasks, and Objects are built together because they share underlying code.

Rules: [Build order](../../atlas/build-order.md)
