# Working on the Atlas SDK

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The SDK: client behavior and the Core-to-gateway API, plus the transport adapters. It loads `protocol/definitions/` and never defines a message itself; message and storage formats live in `protocol/`.
- [README](README.md) is the overview and doc map. Each part of the SDK has one doc in `docs/`. Put a new rule in the doc for its part and link to it from elsewhere; do not copy it.
- Runtime code is not built yet. Build it from [IMPLEMENTATION.md](IMPLEMENTATION.md): one slice per PR, in order, and the developer approves each merge before the next slice starts.
- The SDK is not released yet. How it is tagged is decided when it has code.
- Do not merge without the developer's approval.
