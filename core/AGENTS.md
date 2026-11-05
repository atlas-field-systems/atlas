# Working on Atlas Core

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It carries the version, released as `v<major.minor>.<patch>` tags: major.minor is the protocol version, and the patch counts releases that change no message. Also the SDK, in `sdk/`: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) as their own packages. How-it-works is locked for protocol 0.8 (`sdk/how-it-works.md`); runtime code is not built yet | Spec active, SDK how-it-works locked, runtime not built |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. First-flight prototype; moves only to Protocol release tags. Will adopt the SDK front door once the SDK exists | Prototype |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to **protocol**, in `sdk/`.

[atlas-core](https://github.com/atlas-field-systems/atlas-core) and [atlas-core-archive](https://github.com/atlas-field-systems/atlas-core-archive) are the old Core. They are temporary read-only references to mine for docs and will be deleted. Nothing there is decided for the new parts; write what is kept into the owning repo. The [sdk](https://github.com/atlas-field-systems/sdk) repository is archived; the SDK lives in protocol's `sdk/`.

## Charter first

Before changing code or docs, read the Charter
([atlas CHARTER.md](https://github.com/atlas-field-systems/atlas/blob/main/CHARTER.md))
and [design decisions](https://github.com/atlas-field-systems/atlas/blob/main/design-decisions.md).
Shared fundamentals of coding across Atlas live there — always uphold them. This
repository's rules below add local detail; they do not replace the Charter.

## Subagents

When you direct a subagent, hand off a slice, or spawn parallel work, put the
Charter fundamentals (judgment + design decisions that apply) and this repo's
local rules into that agent's brief. Do not assume it already knows them. The
Charter is how Atlas keeps code quality.

## This repository

- Core's internal behavior, storage use and failure rules go here.
- Message and storage formats live in **protocol**; do not define them here.
- How clients talk to Core lives in **protocol**, in `sdk/`.
- Prototypes are approved: build small, learn, and write findings to [docs/findings.md](docs/findings.md) so they can go back into Protocol and the Charter. Do not change Protocol from here.
- Run `npm test` before every PR. Do not merge without the developer's approval.
- Releases: raise `version` in `package.json` on main, then `git push origin main:production` once the developer approves. Core releases only on a Protocol release tag.

## Working rules

Working rules for every Atlas repository:

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge.
- No CDN dependencies: pages and tools load nothing from third-party servers at run time; ship what they need in the repo or the package.
