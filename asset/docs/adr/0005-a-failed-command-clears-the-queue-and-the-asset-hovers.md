---
status: accepted
date: 2026-11-15
---

# A failed command clears the queue and the Asset hovers

A failed command clears the Asset's remaining queue, because later work may depend on it. There is no clear count. Tasks that arrive later run normally, and the operator cancels any they no longer want.

When a command fails or times out on a flying Asset, it stops and hovers. If Land or Return to home fails after descent starts, it keeps descending. A failed critical battery response still falls back to Return to home.

Rules: [A failed command cancels the remaining Tasks](../failsafes.md#a-failed-command-cancels-the-remaining-tasks)
