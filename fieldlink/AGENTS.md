# Working on Atlas Fieldlink

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- `README.md` owns what every Fieldlink is and provides. Each Fieldlink lives in
  `<name>/` as its own package with its own version, holding both its gateway
  side and its Asset side.
- Each Fieldlink owns compact encoding, retries, duplicate handling, contact
  timing, and link security for its medium. Put those rules with that Fieldlink.
- A Fieldlink never decides Asset behavior. It reports link facts and carries
  what it is given ([the boundary](README.md#the-fieldlink-moves-messages-the-asset-decides)).
- A Fieldlink uses only the [gateway interface](../gateway/README.md#the-gateway-interface)
  and the [Asset link](../sdk/docs/asset.md#the-asset-link), never the SDK directly.
- Shared records live in `protocol/`, how a gateway talks to Core lives in the
  [Core API](../core/docs/api.md), and how radio Assets register lives in
  [Runs and identity](../atlas/runs-and-identity.md). Link to those rules; do not
  copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
