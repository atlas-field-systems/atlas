# Working on Atlas Gateway

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The gateway app goes here: connecting to Core, installing and running a
  Fieldlink, the [gateway interface](README.md#the-gateway-interface), contact,
  and the gateway's Reset ZIP.
- Fieldlinks live in [fieldlink/](../fieldlink/), not here. Radio rules belong
  with each Fieldlink.
- Shared records live in `protocol/`, how a gateway talks to Core lives in
  the [Core API](../core/docs/api.md), and how radio Assets register and keep
  their IDs lives in [Runs and identity](../atlas/runs-and-identity.md). Link to
  those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
