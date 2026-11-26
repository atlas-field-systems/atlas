---
status: accepted
date: 2026-11-11
---

# Stopping Core on purpose is the only Reset

Only stopping Core is a Reset, and a host shutdown or a container stop counts as stopping it. A crash, power loss, or unplanned reboot keeps the same picture with the same Asset IDs and Task numbering, and operators reconnect.

Across Reset, accounts, connection keys, and installed Plugin setup carry over. The picture, Asset IDs, and operator state are discarded. Everyone signs in again, and a shared link made before a Reset opens nothing after it.

Why: starting, stopping, resetting and updating Atlas are the user's job, and Atlas manages no sessions of its own. Updating means a full Reset.

Rules: [The picture and Reset](../../atlas/reset-and-identity.md#the-picture-and-reset), [What carries over](../../atlas/reset-and-identity.md#what-carries-over)
