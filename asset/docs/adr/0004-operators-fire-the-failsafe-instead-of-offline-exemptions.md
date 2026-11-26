---
status: accepted
date: 2026-11-11
---

# Operators fire the failsafe instead of offline exemptions

Land, Return to home, Hold, and Fail-safe all require contact, with no offline exemptions. Operators can send Fail-safe to an online Asset, while an Asset out of contact relies on local protection.

When an Asset receives Fail-safe, it acts as if a failsafe fired. It runs the operator's matching rule, and falls back to the maker's built-in safe action only if no rule applies.

Rules: [An operator can fire the failsafe](../failsafes.md#an-operator-can-fire-the-failsafe), [Operator requests](../../../core/docs/api.md#operator-requests)
