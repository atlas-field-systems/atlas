# Working on the Atlas SDK

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The SDK: client behavior and the Core-to-gateway API, plus the transport adapters.
  It loads `protocol/definitions/` and never defines a message itself; shared
  messages and domain-storage records live in `protocol/`. SDK diagnostics and
  library controls live in [logging](docs/logging.md) and [config.md](config.md).
- [README](README.md) is the overview and doc map. Each part of the SDK has one doc in `docs/`. Put a new rule in the doc for its part and link to it from elsewhere; do not copy it.
- Planning only until the owner requests implementation. Runtime code is not
  built yet. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the future SDK build plan;
  it does not authorize starting that work.
- The SDK is not released yet. How it is tagged is decided when it has code.
- Do not merge without the developer's approval.
