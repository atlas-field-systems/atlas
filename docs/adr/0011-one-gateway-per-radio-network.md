---
status: accepted
date: 2026-11-14
---

# One gateway per radio network

One gateway serves each radio network, and each radio Asset uses exactly one gateway. On a mesh, Assets talk to one another and to their network's gateway. Two gateways in the same radio network are out of scope.

One Core can serve several networks at once when their links cannot clash, such as networks in different areas or on different bands.

Rules: [Setup](../../atlas/scale.md#setup), [Radio Assets](../../atlas/runs-and-identity.md#radio-assets)
