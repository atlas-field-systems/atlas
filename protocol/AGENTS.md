# Working on Atlas Protocol

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | Every Atlas data format: messages and the storage layout, with definitions, checks and a viewer | Active |
| [core](https://github.com/atlas-field-systems/core) | The new Atlas Core: the server that keeps the shared picture and requests work | Not started |
| [sdk](https://github.com/atlas-field-systems/sdk) | The Atlas SDK: client library for gateways, Assets and apps, including the Core-to-gateway API | Not started |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core? Go to **sdk**.

## This repository

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a message elsewhere.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the developer's decisions; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- `storage/` will hold storage formats (to be planned).
- Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval.
