---
status: accepted
date: 2026-11-10
---

# Tracks come only from Fusion and never go stale within a run

Only Fusion creates, changes, or removes Tracks. Within a run, Observations stay in the picture until the run ends, and Tracks stay until Fusion removes them or the run ends.

Core adds no stale status, because a time-only change produces no event for a reader to follow from a snapshot. Readers show age from each record's time instead.

Rules: [Entities](../api.md#entities), [Track freshness](../fusion.md#track-freshness)
