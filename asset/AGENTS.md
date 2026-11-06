# Working on Atlas Asset

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It carries the version, released as `v<major.minor>.<patch>` tags: major.minor is the protocol version, and the patch counts releases that change no message. Also the SDK, in `sdk/`: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) as their own packages. How-it-works is locked for protocol 0.8 (`sdk/how-it-works.md`); runtime code is not built yet | Spec active, SDK how-it-works locked, runtime not built |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. First-flight prototype; moves only to Protocol release tags. Will adopt the SDK front door (shared `check()`, no second validation engine) once the SDK exists | Prototype |
| [asset](https://github.com/atlas-field-systems/asset) | Atlas Asset: the software on an Asset (a drone or other equipment) and how it behaves, from start-up to shutdown | Planning |
| [command-interface](https://github.com/atlas-field-systems/command-interface) | Atlas Command Interface: the operator interface a person uses to watch Assets and request work | Planning |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how an Asset behaves? Go to **asset**.
- Want how the command interface works? Go to **command-interface**.
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

- How an Asset behaves goes here, from start-up to shutdown: starting up and setting home, connecting, taking Tasks, failsafes and reconnecting.
- Write down how a decent Asset behaves. Core relies on it, so a rule that only guards Core against a misbehaving Asset belongs here as Asset behavior instead.
- Message and storage formats live in **protocol**, and how an Asset talks over a link lives in **protocol**, in `sdk/`. Link to those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.

## Working rules

Working rules for every Atlas repository:

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge.
- No CDN dependencies: pages and tools load nothing from third-party servers at run time; ship what they need in the repo or the package.
