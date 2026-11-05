# Working on Atlas Protocol

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

When you direct a subagent, hand off a slice, or spawn parallel work, give a
**compact brief**: the task and scope; links to the authoritative documents
(Charter, design decisions, and this repo's rules) for the revision in use; the
few constraints that materially affect this task; the expected result and how it
will be checked. Do not paste the entire Charter. Do not assume the subagent
already knows the fundamentals.

## This repository

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a message elsewhere.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the developer's decisions; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- `storage/` will hold storage formats (to be planned).
- `sdk/` holds the SDK: client behavior and the Core-to-gateway API. It loads `definitions/` and never defines a message itself. How-it-works is locked for 0.8 ([sdk/README.md](sdk/README.md), [sdk/how-it-works.md](sdk/how-it-works.md)); runtime code is not built yet. Build it from [sdk/IMPLEMENTATION.md](sdk/IMPLEMENTATION.md): one slice per PR, in order, and the developer approves each merge before the next slice starts.
- **Versions and releases.** Never edit a version by hand; `npm run bump -- <major.minor>` sets it everywhere ([law 10](docs/laws.md)). Main carries the version being worked on, and PRs may amend it until it is released. When the developer calls a version done, release it with `git push origin main:production`: the release workflow runs the checks, tags `v<major.minor>.0`, and writes the GitHub release from that version's `docs/changelog.md` section. Later pushes that change no message (SDK, tools) release `v<major.minor>.1`, `.2` and so on, numbered by the workflow; a push that changes a message without a bump is refused. Only commits on main are released, and `production` cannot be force-pushed or deleted. Core and other users move only to release tags. The first PR after a release that changes messages or storage bumps to the next version.
- Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval.

## Working rules

Working rules for every Atlas repository:

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge.
- No CDN dependencies: pages and tools load nothing from third-party servers at run time; ship what they need in the repo or the package.
