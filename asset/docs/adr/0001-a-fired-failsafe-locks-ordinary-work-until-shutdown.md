---
status: accepted
date: 2026-11-16
---

# A fired failsafe locks ordinary work until shutdown

Once a failsafe fires, the Asset stays in failsafe state until shutdown. Failsafe state cannot be cancelled, and ordinary work cannot resume. Operators can still override the response with Land, Return to home, or Hold sent with `now`, or with pause.

Hold now, pause, or a failed Land or Return to home override re-arms every rule, keeping the Asset under its full policy. A re-armed rule fires again if its condition recurs. A critical battery rule can act at once, including at a lower critical level during Hold or pause, so a held Asset cannot hover until its battery runs out.

Rules: [Lock ordinary work for the rest of the operation](../failsafes.md#lock-ordinary-work-for-the-rest-of-the-operation), [An override with Hold or pause re-arms protection](../failsafes.md#an-override-with-hold-or-pause-re-arms-protection)
