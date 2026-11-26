# Working on Atlas Tools

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- `README.md` owns what an Atlas Tool is. Each Tool lives in `<name>/`.
- A Tool packages existing parts and the glue for one kind of equipment. It
  adds no Atlas behavior. A rule about how an Asset behaves, how it reaches
  Core, or how a field link works belongs with that part, not here.
- A Tool is not a Fieldlink and carries no Atlas messages over a field link.
- No other part depends on a Tool. Never make a part need one.
- Shared records live in `protocol/`, how an Asset talks to Core lives in the
  [Core API](../core/docs/api.md), and Asset behavior lives in
  [asset/](../asset/README.md). Link to those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
