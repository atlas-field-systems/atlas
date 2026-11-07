# Working on Atlas Core

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- Core's internal behavior, storage use and failure rules go here.
- Message and storage formats live in `protocol/`; do not define them here.
- How clients talk to Core lives in `sdk/`.
- Core reads the Protocol release pinned in `package.json` (`"protocol"`), unpacked into `protocol/` here by `npm run protocol` (run before `test`, `start` and `demo`). Never point Core at `../protocol`.
- Prototypes are approved: build small, learn, and write findings to [docs/findings.md](docs/findings.md) so they can go back into Protocol and the Charter. Do not change Protocol from here.
- Run `npm test` before every PR. Do not merge without the developer's approval.
- Releases: raise `version` in `package.json` on main, then `git push origin main:prod` once the developer approves. The release workflow tags `core-v<version>`. Core releases only on a Protocol release tag.
