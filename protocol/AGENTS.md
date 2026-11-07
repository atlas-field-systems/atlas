# Working on Atlas Protocol

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here, laws and SDK included, is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- `definitions/` is the source of truth. Docs, the CLI and the viewer follow it; never hardcode a message elsewhere.
- [docs/laws.md](docs/laws.md) lists the rules every definition follows. Change a law on purpose before breaking it.
- [docs/decisions.md](docs/decisions.md) records the developer's decisions; [docs/open-questions.md](docs/open-questions.md) lists what is not decided.
- [docs/storage.md](docs/storage.md) is how Core stores data. Stored record formats are not defined yet.
- The SDK lives in its own folder, [`sdk/`](../sdk/README.md). It loads `definitions/` and never defines a message itself.
- **Versions and releases.** Never edit a version by hand; `npm run bump -- <major.minor>` sets it everywhere ([law 10](docs/laws.md)). Main carries the version being worked on, and PRs may amend it until it is released. When the developer calls a version done, release it with `git push origin main:prod`: the release workflow runs the checks, tags `protocol-v<major.minor>.0`, and writes the GitHub release from that version's `docs/changelog.md` section. Later pushes that change no message (docs, tools) release `protocol-v<major.minor>.1`, `.2` and so on, numbered by the workflow; a push that changes a message without a bump is refused. Only commits on main are released. Core and other users move only to release tags. The first PR after a release that changes messages or storage bumps to the next version.
- Run `npm run check` and `npm test` before every PR. Do not merge without the developer's approval.
