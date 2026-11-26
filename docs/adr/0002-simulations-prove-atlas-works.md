---
status: superseded by ADR-0019
date: 2026-11-14
---

# Simulations prove Atlas works

Simulations is its own part of Atlas and owns end-to-end tests and evals of whole operations. For now, simulations provide the proof that Atlas works, with real flight proof deferred. They run the real code of every part without hardware and simulate only equipment and links, because changing how a part runs for testing weakens the evidence. Scripted Assets are replaced with the real app when it is built, and its ArduPilot SITL and simulated equipment bench live in Simulations.

Unit tests stay few. For any failure, first reproduce it in a simulation if it crosses parts, or at the part's contract if it stays inside one part. Keep the test after it proves the fix.

Rules: [Simulations](../../simulations/README.md), [Asset simulations](../../simulations/docs/asset.md), [Test what matters](../../atlas/CHARTER.md#test-what-matters)
