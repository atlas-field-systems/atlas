---
status: accepted
date: 2026-11-12
---

# The Reset ZIP is the only copy of a run

A run's data stays available during the run, and after a deliberate stop Core clears it only once the Reset ZIP passes verification. That checked ZIP is the only retained copy and is never deleted automatically. [Prototyping showed](../../atlas/archive/prototype-findings.md) that an export can fail or be incomplete, so the sources stay until the ZIP checks out.

If their Reset ZIP fails, Core, each Asset, and each gateway keep their source records and notify their admin or operator. They do not retry automatically on a later start. A crash during Core's deliberate stop resumes the run.

Rules: [Core Reset](../../core/docs/reset.md), [Export the Asset's Reset ZIP](../../asset/docs/logging.md#export-the-assets-reset-zip), [The gateway's Reset ZIP](../../gateway/README.md#the-gateways-reset-zip)
