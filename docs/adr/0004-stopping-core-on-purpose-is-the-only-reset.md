---
status: accepted
date: 2026-11-11
---

# Stopping Core on purpose is the only Reset

Only a deliberate stop of Core by an admin is a Reset. A crash, power loss, or unplanned reboot resumes the same run with the same Asset IDs and Task numbering, and operators reconnect.

Across Reset, accounts, connection keys, and installed Plugin setup carry over. The picture, Asset IDs, and operator state are discarded. Everyone signs in again, and shared links belong only to the run that created them.

Why: not recorded.

Rules: [A run and Reset](../../atlas/runs-and-identity.md#a-run-and-reset), [What carries over](../../atlas/runs-and-identity.md#what-carries-over)
