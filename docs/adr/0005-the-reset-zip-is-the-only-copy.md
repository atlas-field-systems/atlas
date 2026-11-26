---
status: accepted
date: 2026-11-12
---

# The Reset ZIP is the only copy

Core keeps its data until it is stopped, and then clears it only once the Reset ZIP passes verification. That checked ZIP is the only retained copy and is never deleted automatically. [Prototyping showed](../../atlas/archive/prototype-findings.md) that an export can fail or be incomplete, so the sources stay until the ZIP checks out.

Once Core's ZIP is written and checked, the Reset is done, even if Core crashes before it finishes clearing. A crash before the check keeps the picture, as any crash does.

If their Reset ZIP fails, Core, each Asset, and each gateway delete nothing and notify their admin or operator. The data is left for the admin to handle by hand. Atlas has no export or retry feature for it.

Rules: [Core Reset](../../core/docs/reset.md), [Export the Asset's Reset ZIP](../../asset/docs/logging.md#export-the-assets-reset-zip), [The gateway's Reset ZIP](../../gateway/README.md#the-gateways-reset-zip)
