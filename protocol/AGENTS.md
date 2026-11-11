# Working on Atlas Protocol

Read the [root AGENTS.md](../AGENTS.md) first for the parts of Atlas, Charter first,
branches and releases, and the working rules.
Everything here, laws included, is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a record elsewhere.
- Protocol defines shared records and their validator. The [Core API](../core/docs/api.md) and the Fieldlink docs define how programs talk, including requests, events, delivery, acknowledgements, and credentials. Do not add link mechanics here.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the choices behind the records; the owner's product decisions are in the [decision log](../atlas/decision-log.md), which wins; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- Each definition's examples are the validator's test vectors. Add an example for every kind and every case a record can take. Programs' behavior tests do not come from these examples ([tests come from behavior](../atlas/design-decisions.md#tests-come-from-behavior)).
- `parked/` holds earlier definitions waiting to be reworked into records. They are not listed in `definitions/index.json` and not checked. Bring one back by reworking it into a record under `definitions/`.
- Local runtime configuration and diagnostic logs belong to Core, Asset, and SDK docs, not Protocol definitions.
- **Package release identity.** Protocol is unpublished. When published, its package version is its only version ([law 14](docs/laws.md)). Publishing is not configured yet. Release only approved work from `main`. Do not add a separate draft version, bump script, or version fields.
- Run `npm run check`, `npm test` and `npm run build:site` before every PR. Do not merge without the developer's approval.
