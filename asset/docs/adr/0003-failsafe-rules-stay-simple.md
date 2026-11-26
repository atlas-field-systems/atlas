---
status: accepted
date: 2026-11-13
---

# Failsafe rules stay simple

Each failsafe firing runs its response once, with no retries and no configurable fallback. Priority decides which rule interrupts a running response. Once it ends, another firing can act.

Rules have no separate missing- or stale-data conditions. Area rules keep their distance margin and time outside. Battery rules use a fixed percentage rather than estimating the charge needed to get home, so they do not wait too long to fire. When several critical battery rules match, the highest-priority one wins. If its response fails while the battery is still critical, the one fallback is Return to home.

## Considered options

Responses are meant to protect the Asset, and there is no "continue" response. Operators can pick any supported command except Fail-safe. This replaced restricting responses to commands marked protective, because the operator is trusted to pick a sensible response.

Rules: [No rules are enabled by default](../failsafes.md#no-rules-are-enabled-by-default), [Configure conditions as well as responses](../failsafes.md#configure-conditions-as-well-as-responses), [A failsafe activates a configured Task](../failsafes.md#a-failsafe-activates-a-configured-task), [An override with Hold or pause re-arms protection](../failsafes.md#an-override-with-hold-or-pause-re-arms-protection)
