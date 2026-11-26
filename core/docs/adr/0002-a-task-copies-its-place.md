---
status: accepted
date: 2026-11-11
---

# A Task copies its place

A Task that names a place carries a copy of that place as it stood when sent, so a later map edit cannot silently redirect the work. Place edits and deletes always go through, and neither cancels any Task.

When a place is edited, the operator is asked whether to update unfinished Tasks that use it, and Core sends updates only if they approve. Deleting a place leaves sent Tasks unchanged.

Rules: [Geo features](../api.md#geo-features)
