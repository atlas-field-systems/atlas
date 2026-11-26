---
status: accepted
date: 2026-11-25
---

# Simulations prove Atlas works, and deep modules get focused tests

Simulations is its own part of Atlas and owns end-to-end tests and evals of whole operations. For now, simulations provide the proof that Atlas works, with real flight proof deferred. They run the real code of every part without hardware and simulate only equipment and links, because changing how a part runs for testing weakens the evidence. The real Asset app replaces scripted Assets, and its ArduPilot SITL and simulated equipment bench live in Simulations.

Cross-part behavior is tested in simulations. Dense logic inside one part, such as failsafe rules or the Task queue, may have focused tests at that module's own interface, never its internals. Parts prefer deep modules, a small interface over a lot of behavior, so that logic is easy to test this way.

Every failure is reproduced first: in a simulation if it crosses parts, otherwise at the interface of the module it stays inside. The test stays after it proves the fix.

Why: some logic has too many cases to cover well from a whole operation, and a test at a deep module's interface survives refactors that a test of internals would not.

Supersedes [ADR-0002](0002-simulations-prove-atlas-works.md), which kept unit tests few.

Rules: [Test what matters](../../atlas/CHARTER.md#test-what-matters), [Simulations](../../simulations/README.md), [Asset simulations](../../simulations/docs/asset.md)
