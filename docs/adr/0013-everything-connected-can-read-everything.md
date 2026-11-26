---
status: accepted
date: 2026-11-14
---

# Everything connected can read everything

Every connected operator, Asset, gateway, and Plugin can read the same Core data, including data about other Assets, because Atlas serves one trusted group sharing a picture. This applies only to reads. Work requests and account and key administration keep their own permissions, and Core never returns credential secrets.

Rules: [Reads](../../core/docs/api.md#reads)
