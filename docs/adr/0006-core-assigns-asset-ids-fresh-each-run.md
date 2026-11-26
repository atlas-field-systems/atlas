---
status: accepted
date: 2026-11-12
---

# Core assigns Asset IDs, fresh each run

Core assigns and returns every Asset ID at registration, so Core stays the authority for Asset identity. Each run starts the picture fresh, and every Asset registers again for a new ID. Core never reuses an Asset ID, even across runs. If IDs run out, Core refuses new registrations and tells the admin. Assets still choose their own Observation IDs.

Within a run, one IP access key registers at most one Asset at a time, and admins provision only the key. That key identifies the same Asset on reconnect or app restart, even if the app forgot its ID. Radio Assets need no advance setup. The gateway registers a radio when first heard and registers it again when its app restarts, using its radio identity with no separate restart signal.

Both IP and radio Assets keep their IDs within a run unless an admin removed them, in which case registering again creates a new Asset. Old work never resumes after an app restart.

Rules: [IDs](../../atlas/runs-and-identity.md#ids), [Keys and registration](../../atlas/runs-and-identity.md#keys-and-registration), [Radio Assets](../../atlas/runs-and-identity.md#radio-assets)
