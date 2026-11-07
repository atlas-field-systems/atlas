# Working on Atlas Core

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- Core's internal behavior, storage use and failure rules go here.
- Shared message and domain-storage formats live in `protocol/`; do not define
  them here. Local configuration and diagnostic records belong here, in
  [config.md](config.md) and [logging](docs/logging.md).
- How clients talk to Core lives in `sdk/`.
- Core reads the Protocol release pinned in `package.json` (`"protocol"`), unpacked into `protocol/` here by `npm run protocol` (run before `test`, `start` and `demo`). Never point Core at `../protocol`.
- The existing runtime is a retained prototype using a historical Protocol
  snapshot. It is not the source for the current design. Work is documentation
  only until the owner requests a prototype pass. Keep findings in
  [docs/findings.md](docs/findings.md); the owner has not decided whether to keep
  or replace the runtime.
- Run `npm test` before every PR. Do not merge without the developer's approval.
- Releases: raise `version` in `package.json` on main, then `git push origin main:prod` once the developer approves. The release workflow tags `core-v<version>`. Core releases only on a Protocol release tag.
