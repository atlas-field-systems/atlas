# Working on Atlas Core

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- Core's internal behavior, the Core API, storage use and failure rules go here.
  [docs/api.md](docs/api.md) is the API every outside program uses.
- Shared record formats live in `protocol/`; do not define them here. Local
  configuration and diagnostic records belong here, in [config.md](config.md)
  and [logging](docs/logging.md).
- The client programs use to call the API lives in `sdk/`.
- Planning only: no runtime code until the owner asks. Do not merge without the
  developer's approval.
