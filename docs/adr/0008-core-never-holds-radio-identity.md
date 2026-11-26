---
status: accepted
date: 2026-11-22
---

# Core never holds radio identity

Radio identity stays on the gateway and its Fieldlink, never in Core. Core trusts the gateway to identify which Asset sent each message.

On every Fieldlink, the sender comes from the radio itself, so a bug or misconfiguration cannot make one radio speak as another. The gateway checks identity and rejects replayed frames. Stopping someone who already holds a radio's keys is not required.

Rules: [What every Fieldlink provides](../../fieldlink/README.md#what-every-fieldlink-provides), [Radio Assets](../../atlas/reset-and-identity.md#radio-assets)
