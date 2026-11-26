---
status: accepted
date: 2026-11-12
---

# Core assigns Asset IDs, fresh after each Reset

Core assigns and returns every Asset ID at registration, so Core stays the authority for Asset identity. Each Reset clears the picture, and every Asset registers again for a new ID. Core never reuses an Asset ID, even across a Reset. If IDs run out, Core refuses new registrations and tells the admin. Assets still choose their own Observation IDs.

Until the next Reset, one IP access key registers at most one Asset at a time, and admins provision only the key. That key identifies the same Asset on reconnect or app restart, even if the app forgot its ID. Radio Assets need no advance setup. The gateway registers a radio when first heard and registers it again when its app restarts, using its radio identity with no separate restart signal.

Both IP and radio Assets keep their IDs until the next Reset unless an admin removed them, in which case registering again creates a new Asset. Old work never resumes after an app restart.

Rules: [IDs](../../atlas/reset-and-identity.md#ids), [Keys and registration](../../atlas/reset-and-identity.md#keys-and-registration), [Radio Assets](../../atlas/reset-and-identity.md#radio-assets)
