# Working on Atlas

Atlas is one repository, [atlas-field-systems/atlas](https://github.com/atlas-field-systems/atlas),
in the [atlas-field-systems](https://github.com/atlas-field-systems) GitHub organization.
Each part of Atlas is a top-level folder. Everything is on disk together, so read the
other folders for context, and change several in one PR when a change spans them.

## The parts

| Folder | What lives there | Status |
|---|---|---|
| [atlas/](atlas/) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol/](protocol/) | The spec: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It carries the version, released as `protocol-v<major.minor>.<patch>` tags: major.minor is the protocol version, and the patch counts releases that change no message. Also the SDK, in `sdk/`: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) as their own packages. How-it-works is locked for protocol 0.8 (`sdk/how-it-works.md`); runtime code is not built yet | Spec active, SDK how-it-works locked, runtime not built |
| [core/](core/) | Atlas Core: the server that keeps the shared picture and requests work. First-flight prototype; pins a Protocol release tag. Will adopt the SDK front door (shared `check()`, no second validation engine) once the SDK exists | Prototype |
| [asset/](asset/) | Atlas Asset: the software on an Asset (a drone or other equipment) and how it behaves, from start-up to shutdown | Planning |
| [command-interface/](command-interface/) | Atlas Command Interface: the operator interface a person uses to watch Assets and request work | Planning |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to `atlas/`.
- Want the exact shape of a message or of stored data? Go to `protocol/`.
- Want how Core works inside? Go to `core/`.
- Want how an Asset behaves? Go to `asset/`.
- Want how the command interface works? Go to `command-interface/`.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to `protocol/sdk/`.

Each folder has its own `AGENTS.md` with its local rules. Read it before working there.
Links of the form `https://github.com/atlas-field-systems/atlas/blob/main/<path>` are
the file at `<path>` in this repository.

## Charter first

Before changing code or docs, read [the charter](atlas/CHARTER.md) and
[design decisions](atlas/design-decisions.md). Shared fundamentals of coding across
Atlas live there — always uphold them. Folder rules add local detail; they do not
replace the Charter.

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

## Subagents

When you direct a subagent, hand off a slice, or spawn parallel work, give a
**compact brief**: the task and scope; links to the authoritative documents
(Charter, design decisions, and the affected folders' `AGENTS.md`) for the revision in
use; the few constraints that materially affect this task; the expected result and
how it will be checked. Do not paste the entire Charter. Do not assume the subagent
already knows the fundamentals.

## Branches and releases

- `main` is where work lands, through PRs. Nothing leaves the repository from `main`.
- `prod` is what is released. When the developer approves, `git push origin main:prod`.
  Only commits on `main` are released; never commit to `prod` directly. The release
  workflow tags and releases each part that changed: Protocol as `protocol-v…`, Core as
  `core-v…` (see `protocol/AGENTS.md` and `core/AGENTS.md`).
- Core never reads `protocol/` on `main`. It pins a Protocol release in `core/package.json`.
- Later, a push to `prod` will also update a read-only copy of each folder in its own
  repository. That is not built yet.

## Working rules

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge. Each part's checks run in `.github/workflows/` when that folder changes.
- No CDN dependencies: pages and tools load nothing from third-party servers at run time; ship what they need in the repo or the package.
