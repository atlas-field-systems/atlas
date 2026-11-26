---
status: superseded by ADR-0022
date: 2026-11-10
---

# Tracks come only from Fusion and never go stale

Only Fusion creates, changes, or removes Tracks. Observations stay in the picture until the next Reset, and Tracks stay until Fusion removes them or the next Reset.

Core adds no stale status, because a time-only change produces no event for a reader to follow from a snapshot. Readers show age from each record's time instead.

Rules: [Entities](../api.md#entities), [ADR-0022](../../../docs/adr/0022-core-serves-observations-only-fusion-and-tracks-wait-in-the-drawer.md)
