# Working on Atlas Core

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

- Core's internal behavior, storage use and failure rules go here.
- Message and storage formats live in **protocol**; do not define them here.
- How clients talk to Core lives in **sdk**.
- Do not build before the developer approves the plans. Do not merge without the developer's approval.
