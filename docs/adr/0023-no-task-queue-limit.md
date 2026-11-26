---
status: accepted
date: 2026-11-26
---

# No Task queue limit

An Asset's Task queue has no cap. Core admits ordinary Tasks without checking a queue limit, and an Asset keeps every Task it receives instead of cancelling work when a cap is reached. There is no `queue_full` refusal.

Task IDs stay limited to 9999 per Asset between Resets.

Why: the owner wants the Task system kept simple and does not foresee a real limit in use. Queue reports grow on the field link, which the owner accepts.

Supersedes Core ADR-0001.

Rules: [Operator requests](../../core/docs/api.md#operator-requests), [The queue](../../asset/docs/README.md#the-queue)
