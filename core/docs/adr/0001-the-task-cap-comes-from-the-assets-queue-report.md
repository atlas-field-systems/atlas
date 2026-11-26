---
status: superseded by ADR-0023
date: 2026-11-12
---

# The Task cap comes from the Asset's queue report

Core enforces a cap of 64 ordinary Tasks per Asset from the Asset's latest queue report, because the Asset knows what work it holds. Work still in transit or awaiting a final report does not reserve capacity. Core still admits a `now` Task at the cap.

Rules: [Operator requests](../api.md#operator-requests)
