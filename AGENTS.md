# Working on Atlas

Atlas is one repository, [atlas-field-systems/atlas](https://github.com/atlas-field-systems/atlas),
in the [atlas-field-systems](https://github.com/atlas-field-systems) GitHub organization.
Each part of Atlas is a top-level folder. Everything is on disk together, so read the
other folders for context, and change several in one PR when a change spans them.

**This is where Atlas work is implemented.** Every plan, doc, spec change and line of
code for every part is written, reviewed and merged here, through PRs into `main`.
There is no other repository to change. Any per-part repository made later is a
read-only copy published from `prod`; never edit one.

**Everything here is a draft.** Atlas is greenfield and deployed nowhere. Any
decision, law, message, plan or code may be reworked, rewritten or removed; nothing
is locked. Propose changes to the owner rather than making them quietly. See
[Everything is a draft](atlas/CHARTER.md#everything-is-a-draft).

## The parts

| Folder | What lives there | Status |
|---|---|---|
| [atlas/](atlas/) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol/](protocol/) | The spec: shared domain records as definitions, laws, examples and docs, plus the one validator. Component configuration and diagnostic logs live with their owners. When published, its package version is its only version; definitions and records carry no protocol version | Draft, unpublished |
| [sdk/](sdk/) | The SDK: the client for the Core API, used by operator applications, Assets on IP and gateways. Loads Protocol's definitions; defines no record itself. Runtime code is not built yet | Draft docs, runtime not built |
| [core/](core/) | Atlas Core: the server that keeps the shared picture and the event log, serves the Core API, and runs Fusion. The retained first-flight prototype pins a historical Protocol release tag and will be removed | Prototype |
| [asset/](asset/) | Atlas Asset: the software on an Asset (a drone or other equipment) and how it behaves, from start-up to shutdown | Planning |
| [command-interface/](command-interface/) | Atlas Command Interface: the operator interface a person uses to watch Assets and request work | Planning |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to `atlas/`.
- Want the exact shape of a record? Go to `protocol/`.
- Want how Core works inside, or the Core API? Go to `core/`.
- Want how an Asset behaves? Go to `asset/`.
- Want how the command interface works? Go to `command-interface/`.
- Want the client programs use to call the Core API? Go to `sdk/`.
- Want how gateways and Fieldlinks carry Atlas across a field link? Not written
  yet; see [Fieldlinks](atlas/api-proposal.md#fieldlinks).

Atlas is moving from one shared message model to a
[Core API with gateways](atlas/api-proposal.md). The Charter and design decisions
follow it. Protocol, SDK, Core, Asset and Command Interface docs still describe
the earlier model until each is updated.

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
  Only commits on `main` are released; never commit to `prod` directly. Protocol
  package publishing is not configured yet. Its package version will be its only
  version (see `protocol/AGENTS.md`).
- The retained Core prototype never reads `protocol/` on `main`. It pins a
  historical Protocol snapshot in `core/package.json`; it does not follow the current spec.
- Later, a push to `prod` will also update a read-only copy of each folder in its own
  repository. That is not built yet.

## Working rules

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves, with `git merge --no-ff`, then push main.
- CI must be green before any merge. Each part's checks run in `.github/workflows/` when that folder changes.
- No CDN dependencies: ship application code and assets in the repo or package. The Command Interface may use external basemap tile services for its [connected command-station use](command-interface/docs/README.md#operators-and-connectivity).
