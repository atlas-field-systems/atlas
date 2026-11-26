---
status: accepted
date: 2026-11-10
---

# Pause is a setting; Hold is a command

Hold is an ordinary command, like Land. It stops the Asset and keeps no earlier Task to resume. Pause is a setting that keeps the current Task so the operator can continue it.

Why: Pause keeps the current Task so the operator can continue it, and Hold drops it. "paused" and "running" are end states, so resending one over a slow link is harmless.

Rules: [Pause](../../asset/docs/README.md#pause)
