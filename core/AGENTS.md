# Working on Atlas Core

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It carries the version, released as `v<major.minor>` tags. Also the SDK, in `sdk/`: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) as their own packages | Spec active, SDK not built yet |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. Now a first-flight prototype on Protocol 0.6. It moves only to Protocol release tags | Prototype |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to **protocol**, in `sdk/`.

[atlas-core](https://github.com/atlas-field-systems/atlas-core) and [atlas-core-archive](https://github.com/atlas-field-systems/atlas-core-archive) are the old Core. They are temporary read-only references to mine for docs and will be deleted. Nothing there is decided for the new parts; write what is kept into the owning repo. The [sdk](https://github.com/atlas-field-systems/sdk) repository is archived; the SDK lives in protocol's `sdk/`.

## This repository

- Core's internal behavior, storage use and failure rules go here.
- Message and storage formats live in **protocol**; do not define them here.
- How clients talk to Core lives in **protocol**, in `sdk/`.
- Prototypes are approved: build small, learn, and write findings to [docs/findings.md](docs/findings.md) so they can go back into Protocol and the Charter. Do not change Protocol from here.
- Run `npm test` before every PR. Do not merge without the developer's approval.
