---
status: accepted
date: 2026-11-14
---

# One gateway per radio network

One gateway serves each radio network, and each radio Asset uses exactly one gateway. On a mesh, Assets talk to one another and to their network's gateway. Two gateways in the same radio network are out of scope.

One Core can serve several networks at once when their links cannot clash, such as networks in different areas or on different bands.

Each Asset uses one link: either direct IP or one radio network's Fieldlink. Switching an Asset between links waits in the [drawer](../drawer/multiple-links.md).

Why: gateways never have to coordinate registration, duplicate suppression, or command routing.

Rules: [Setup](../../atlas/scale.md#setup), [Radio Assets](../../atlas/reset-and-identity.md#radio-assets), [One link per Asset](../../asset/docs/communications.md#one-link-per-asset)
