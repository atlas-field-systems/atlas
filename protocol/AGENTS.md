# Working on Atlas Protocol

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here, laws and SDK included, is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a message elsewhere.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the developer's decisions; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- [docs/storage.md](docs/storage.md) is how Core stores data. Stored record formats are not defined yet.
- Local runtime configuration and diagnostic logs belong to Core, Asset, and SDK
  docs, not Protocol definitions. Protocol owns shared messages and domain records.
- The SDK lives in its own folder, [`sdk/`](../sdk/README.md). It loads `definitions/` and never defines a message itself.
- **Package release identity.** Protocol is unpublished. When published, its
  package version is its only version ([law 10](docs/laws.md)). Definitions,
  examples, and wire messages carry no protocol version, and links do not
  negotiate one. Publishing is not configured yet. Release only approved work
  from `main`; no separate draft version, bump script, or wire-version tags.
- Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval.
