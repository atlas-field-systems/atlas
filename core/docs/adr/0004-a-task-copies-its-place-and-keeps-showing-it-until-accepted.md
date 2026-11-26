---
status: accepted
date: 2026-11-26
---

# A Task copies its place and keeps showing it until the Asset accepts an edit

A Task that names a place carries a copy of that place as it stood when sent, so a later map edit cannot silently redirect the work. Place edits and deletes always go through, and neither cancels any Task. Deleting a place leaves sent Tasks unchanged.

When a place is edited, the operator is asked whether to update unfinished Tasks that use it, and Core sends updates only if they approve. Each Task keeps showing the old point until the Asset accepts the update, and says so if the update fails or is dropped.

Why: showing the new point as soon as Core sent the update misled operators when the update failed or was dropped while the Asset still flew to the old point.

Supersedes Core ADR-0002.

Rules: [Geo features](../api.md#geo-features), [Area and place inputs](../../../command-interface/docs/README.md#area-and-place-inputs)
