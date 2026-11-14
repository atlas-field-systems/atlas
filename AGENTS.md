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
decision, law, message, plan or code may be reworked, rewritten or removed.
Propose changes to the owner rather than making them quietly. See
[Everything is a draft](atlas/CHARTER.md#everything-is-a-draft) and
[Decisions](#decisions) below.

## The parts

| Folder | What lives there | Status |
|---|---|---|
| [atlas/](atlas/) | The Charter: what Atlas is for, how it is used, project-wide design decisions, the [decision log](atlas/decision-log.md), and [runs and identity](atlas/runs-and-identity.md) | Active |
| [protocol/](protocol/) | The spec: shared domain records as definitions, laws, examples and docs, plus the one validator. Component configuration and diagnostic logs live with their owners. When published, its package version is its only version; definitions and records carry no protocol version | Draft, unpublished |
| [sdk/](sdk/) | The SDK: the client for the Core API, used by operator applications, Assets on IP, gateways and Plugins. Loads Protocol's definitions; defines no record itself. Runtime code is not built yet | Draft docs, runtime not built |
| [core/](core/) | Atlas Core: the server that keeps the shared picture and the event log, serves the [Core API](core/docs/api.md), and runs Fusion. Runtime code is being built | Building |
| [asset/](asset/) | Atlas Asset: the software on an Asset (a drone or other equipment) and how it behaves, from start-up to shutdown | Planning |
| [command-interface/](command-interface/) | Atlas Command Interface: the operator interface a person uses to watch Assets and request work | Planning |
| [gateway/](gateway/) | Atlas Gateway: the gateway app, a framework that installs and runs one Fieldlink at a time and gives it the gateway interface | Planning |
| [fieldlink/](fieldlink/) | Atlas Fieldlink: each Fieldlink package, holding both ends of its field link, released on its own | Planning; SiK and Meshtastic are sketched |
| [simulations/](simulations/) | Atlas Simulations: the real parts run together in a simulated world, as end-to-end tests and evals. Each part's own unit tests stay in its folder | Planning |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to `atlas/`.
- Want the exact shape of a record? Go to `protocol/`.
- Want how Core works inside, or the Core API? Go to `core/`.
- Want how an Asset behaves? Go to `asset/`.
- Want how the command interface works? Go to `command-interface/`.
- Want the client programs use to call the Core API? Go to `sdk/`.
- Want how a gateway connects to Core and installs Fieldlinks? Go to `gateway/`.
- Want how a Fieldlink carries Atlas across a field link? Go to `fieldlink/`.
- Want how the parts are tested together end to end? Go to `simulations/`.
- Want what the owner decided, or what a run is and how Assets get their IDs? Go
  to the [decision log](atlas/decision-log.md) and
  [runs and identity](atlas/runs-and-identity.md).

### Where each topic lives

Each topic has one home. Other pages link to it.

| Topic | Home |
| --- | --- |
| The owner's decisions, dated and scoped | [atlas/decision-log.md](atlas/decision-log.md) |
| Runs, Reset, what carries over, registration, IDs, keys, gateway changes | [atlas/runs-and-identity.md](atlas/runs-and-identity.md) |
| Project-wide principles and architecture | [atlas/CHARTER.md](atlas/CHARTER.md), [atlas/design-decisions.md](atlas/design-decisions.md) |
| Terms | [GLOSSARY.md](GLOSSARY.md), one line each |
| Record shapes and the working choices behind them | [protocol/definitions/](protocol/definitions/), [protocol/docs/decisions.md](protocol/docs/decisions.md) |
| Endpoints, events, admission, the Task cap, contact, places, Objects, Plugin calls | [core/docs/api.md](core/docs/api.md) |
| Core's Reset ZIP, storage, logging | [core/docs/reset.md](core/docs/reset.md), [storage.md](core/docs/storage.md), [logging.md](core/docs/logging.md) |
| Asset behavior: the queue, pause, cancel, places in Tasks | [asset/docs/README.md](asset/docs/README.md) |
| Failsafes and their overrides | [asset/docs/failsafes.md](asset/docs/failsafes.md) |
| Settings, intended use | [atlas/settings.md](atlas/settings.md) |
| Plugins, intended use | [atlas/plugins.md](atlas/plugins.md) |
| The gateway app, installing Fieldlinks, the gateway interface, the gateway's Reset ZIP | [gateway/README.md](gateway/README.md) |
| What every Fieldlink is and provides, and where a Fieldlink stops and the Asset starts | [fieldlink/README.md](fieldlink/README.md) |
| One Fieldlink's radio, behavior, and security | `fieldlink/<name>/README.md` |
| Operator screens and workflows | [command-interface/docs/](command-interface/docs/README.md) |
| The client library | [sdk/](sdk/README.md) |
| End-to-end simulations, scenarios, fault runs, and what each part takes from outside to be simulated | [simulations/](simulations/README.md) |

Superseded plans live in [atlas/archive/](atlas/archive/README.md). They explain
history and are never a source for current rules.

Each folder has its own `AGENTS.md` with its local rules. Read it before working there.
Links of the form `https://github.com/atlas-field-systems/atlas/blob/main/<path>` are
the file at `<path>` in this repository.

## Charter first

Before changing code or docs, read [the charter](atlas/CHARTER.md) and
[design decisions](atlas/design-decisions.md). Shared fundamentals of coding across
Atlas live there — always uphold them. Folder rules add local detail; they do not
replace the Charter.

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

## Decisions

- **The [decision log](atlas/decision-log.md) is authoritative.** When a page
  disagrees with it, the page is wrong. Only the owner's own decisions go in it.
  When the owner says yes to a recommendation, record only the question that
  was asked and answered, with its scope; the rest of the recommendation stays a
  proposal.
- **Working choices never override the decision log.** A choice made in a
  design thread, such as those in
  [Protocol's working choices](protocol/docs/decisions.md), may change with a
  stated reason. It is not an owner decision until the owner makes it.
- **A reversal updates every file that still teaches the old rule**, in the same
  PR: search the whole repository, Protocol definitions included, and add the old
  wording to [the retired phrases](.github/retired-phrases.json).
- **One home per topic.** State each rule once, in the page that owns it. Other
  pages link to it with at most a one-line pointer, never a restatement.
- **State the scope.** Where it matters, say whether a rule holds within a run
  or across runs, for a named place or a drawn shape, and for Hold or pause.
- **Write product rules as outcomes.** Say what the operator, admin or Asset
  sees. Mechanism (endpoints, records, fields) goes in the Core API, Protocol,
  and Fieldlink docs.
- **No page is off limits.** When a change makes another file wrong, fix that
  file too. A brief never tells an agent to leave a file that teaches the old
  rule untouched.

## Subagents

When you direct a subagent, hand off a slice, or spawn parallel work, give a
**compact brief**: the task and scope; links to the authoritative documents
(Charter, design decisions, the decision log, and the affected folders' `AGENTS.md`) for the revision in
use; the few constraints that materially affect this task; the expected result and
how it will be checked. Do not paste the entire Charter. Do not assume the subagent
already knows the fundamentals.

Parallel branches often touch the same shared pages: the glossary, the decision
log, the Core API, and Plugins. Before finishing, a branch merges the latest
`main` and rereads those pages, so it does not bring back a rule another branch
just changed.

## Branches and releases

- `main` is where work lands, through PRs. Nothing leaves the repository from `main`.
- `prod` is what is released. When the developer approves, `git push origin main:prod`.
  Only commits on `main` are released; never commit to `prod` directly. Protocol
  package publishing is not configured yet. Its package version will be its only
  version (see `protocol/AGENTS.md`).
- No release workflow is configured yet; one is added when a part has code to release.
- Later, a push to `prod` will also update a read-only copy of each folder in its own
  repository. That is not built yet.

## Working rules

- Commit as `the-Drunken-coder` with `183743141+the-Drunken-coder@users.noreply.github.com`.
- Never put a personal name or personal email in any file, commit message, PR body, test fixture or example. In prose refer to the owner as "the developer" or "the owner".
- Merge only after the developer approves: a local `git merge --no-ff` with that
  same identity as author and committer, then a normal push of `main`.
  `gh pr merge` rejects the noreply address, and without it GitHub would use a
  personal address.
- CI must be green before any merge. Each part's checks run in `.github/workflows/` when that folder changes.
  Docs changes run `node .github/scripts/check-links.mjs` and
  `node .github/scripts/check-retired.mjs` from the repository root.
- No CDN dependencies: ship application code and assets in the repo or package. The Command Interface may use external basemap tile services for its [connected command-station use](command-interface/docs/README.md#operators-and-connectivity).
