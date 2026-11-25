---
status: accepted
date: 2026-11-11
---

# Nothing restarts a failed Asset app

Nothing restarts a failed Asset app automatically, and Atlas has no remote shutdown or restart. If the app or companion computer fails in flight, the app stays down and operators see the Asset offline. The independent flight controller detects the loss and returns home on its own. A crashed Asset is inspected before its next flight.

Why: not recorded.

Rules: [If the app fails in flight](../failsafes.md#if-the-app-fails-in-flight), [Shut down and retain evidence](../README.md#shut-down-and-retain-evidence), [An operation runs without planned restarts](../../../atlas/using-atlas.md#an-operation-runs-without-planned-restarts)
