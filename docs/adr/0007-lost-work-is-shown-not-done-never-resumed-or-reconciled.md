---
status: superseded by ADR-0024
date: 2026-11-12
---

# Lost work is shown not done, never resumed or reconciled

When an Asset goes offline, unanswered requests and Tasks show as not done, and the operator sends again whatever still matters. Core leaves those states unchanged when the Asset returns, so a request without a final report never implies an observed outcome.

An Asset app restarted on the ground drops its queued Tasks and unreported results. When it registers again, Core marks every Task without a final report as not done. If a gateway is replaced, its radios register as new Assets with new IDs, while the old entries stay offline with their unfinished work.

Rules: [Keys and registration](../../atlas/reset-and-identity.md#keys-and-registration), [When the gateway changes](../../atlas/reset-and-identity.md#when-the-gateway-changes), [Operator requests](../../core/docs/api.md#operator-requests)
