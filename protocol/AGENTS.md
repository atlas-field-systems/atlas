# Working on Atlas Protocol

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec only: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It is what is versioned | Active |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. Now a first-flight prototype on Protocol 0.6 | Prototype |
| [sdk](https://github.com/atlas-field-systems/sdk) | The Atlas SDK: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) | Not built yet |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to **sdk**.

[atlas-core](https://github.com/atlas-field-systems/atlas-core) and [atlas-core-archive](https://github.com/atlas-field-systems/atlas-core-archive) are the old Core. They are temporary read-only references to mine for docs and will be deleted. Nothing there is decided for the new parts; write what is kept into the owning repo.

## This repository

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a message elsewhere.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the developer's decisions; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- `storage/` will hold storage formats (to be planned).
- **Versions and releases.** Never edit a version by hand; `npm run bump -- <major.minor>` sets it everywhere ([law 10](docs/laws.md)). Main carries the version being worked on, and PRs may amend it until it is released. When the developer calls a version done, tag that merge commit `v<major.minor>` and push the tag. Core and other users move only to release tags. The first PR after a release that changes messages or storage bumps to the next version.
- Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval.
