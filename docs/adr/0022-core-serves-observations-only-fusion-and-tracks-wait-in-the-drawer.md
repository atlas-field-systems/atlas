---
status: accepted
date: 2026-11-26
---

# Core serves Observations only; Fusion and Tracks wait in the drawer

Core keeps and serves Observations only. There is no Fusion, no Track, and no Track history in Core's design for now. Fusion and Tracks wait in the drawer until real multi-source Fusion is designed and built.

Observations stay in the shared picture until the next Reset. Core adds no stale status, because a time-only change produces no event for a reader to follow from a snapshot; readers show age from each record's `time` instead.

Why: turning every Observation into a Track was naive, since many single Observations are not a Track. The Track design will be worked out properly when Fusion is built.

Supersedes Core ADR-0003.

Rules: [Entities](../../core/docs/api.md#entities), [Fusion](../drawer/fusion.md)
