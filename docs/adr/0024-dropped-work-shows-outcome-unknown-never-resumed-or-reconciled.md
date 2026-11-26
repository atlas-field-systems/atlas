---
status: accepted
date: 2026-11-26
---

# Dropped work shows outcome unknown, never resumed or reconciled

When an Asset goes offline, Core drops unanswered requests and unfinished Tasks without claiming they did not run. Operators see a dropped Task as outcome unknown, because it may have run before contact ended, and choose whether to send it again. Core leaves dropped states unchanged when the Asset returns; nothing is resumed or reconciled.

An Asset app restarted on the ground drops its queued Tasks and unreported results. When it registers again, Core drops every Task without a final report, showing outcome unknown. If a gateway is replaced, its radios register as new Assets with new IDs, while the old entries stay offline with their unfinished work.

Why: showing a dropped Task as "not done" was misleading when the Asset may have carried it out, such as taking a photo just before contact ended. Showing outcome unknown keeps evidence honest while leaving resending to the operator.

Supersedes ADR-0007.

Rules: [Keys and registration](../../atlas/reset-and-identity.md#keys-and-registration), [When the gateway changes](../../atlas/reset-and-identity.md#when-the-gateway-changes), [Operator requests](../../core/docs/api.md#operator-requests)
