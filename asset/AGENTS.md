# Working on Atlas Asset

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- How an Asset behaves goes here, from start-up to shutdown: starting up and setting home, connecting, taking Tasks, failsafes and reconnecting.
- Write down how a decent Asset behaves. Core relies on it, so a rule that only guards Core against a misbehaving Asset belongs here as Asset behavior instead.
- Shared records live in `protocol/`, and how an Asset talks to Core lives in the
  [Core API](../core/docs/api.md). Link to those rules; do not copy them.
  Local configuration and diagnostic records belong here, in
  [config.md](config.md) and [logging](docs/logging.md).
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
