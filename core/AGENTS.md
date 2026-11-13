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
- The owner asked for Core's runtime on 2026-11-13. It is built whole, all
  pillars together ([decision log](../atlas/decision-log.md#build-and-test)).
- Do not merge without the developer's approval.
