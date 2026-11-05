# Working on the Atlas charter

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It carries the version, released as `v<major.minor>.<patch>` tags: major.minor is the protocol version, and the patch counts releases that change no message. Also the SDK, in `sdk/`: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) as their own packages. How-it-works is locked for protocol 0.8 (`sdk/how-it-works.md`); runtime code is not built yet | Spec active, SDK how-it-works locked, runtime not built |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. First-flight prototype; moves only to Protocol release tags. Will adopt the SDK front door (shared `check()`, no second validation engine) once the SDK exists | Prototype |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to **protocol**, in `sdk/`.

[atlas-core](https://github.com/atlas-field-systems/atlas-core) and [atlas-core-archive](https://github.com/atlas-field-systems/atlas-core-archive) are the old Core. They are temporary read-only references to mine for docs and will be deleted. Nothing there is decided for the new parts; write what is kept into the owning repo. The [sdk](https://github.com/atlas-field-systems/sdk) repository is archived; the SDK lives in protocol's `sdk/`.

## Charter first

Before changing code or docs, read [the charter](CHARTER.md) and
[design decisions](design-decisions.md). Shared fundamentals of coding across
Atlas live there — always uphold them. This repository's rules below add local
detail; they do not replace the Charter.

## Subagents

When you direct a subagent, hand off a slice, or spawn parallel work, give a
**compact brief**: the task and scope; links to the authoritative documents
([the charter](CHARTER.md), [design decisions](design-decisions.md), and this
repo's rules) for the revision in use; the few constraints that materially
affect this task; the expected result and how it will be checked. Do not paste
the entire Charter. Do not assume the subagent already knows the fundamentals.

## This repository

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

Read [README](README.md), [the charter](CHARTER.md), and the affected story first.
This repository explains Atlas's purpose, operating environment, and how its parts
fit together.

## Ownership

Follow [document ownership](CHARTER.md#document-ownership). Keep subsystem behavior,
failure rules, and implementation plans with the owning system. Link to those docs
from the charter instead of importing them. Keep examples here focused on complete
uses of Atlas and the responsibilities of its parts.

Component repositories must point their agent instructions and overview here.
A pending proposal is not an approved contract. If subsystem docs conflict with the
operating context, identify the mismatch and resolve it explicitly with the owner.
Do not silently adopt old behavior or claim intended behavior is implemented.

## Changes

Keep selected direction, proposals, and open questions distinct. Preserve the
owner's testing simplifications. Do not turn a review suggestion into a scheduler,
Plugin platform, or other unrequested scope. Obtain the owner's agreement for
product changes and do not merge without approval.

Working rules for every Atlas repository:

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge.
- No CDN dependencies: pages and tools load nothing from third-party servers at run time; ship what they need in the repo or the package.

Keep pages short and concrete. Put review transcripts and temporary plans in the
PR rather than the charter. Check relative links, anchors, whitespace, and diagram
consistency; report checks actually run. Documentation checks do not qualify runtime
behavior. Do not claim new capabilities exist merely because a story describes them.
