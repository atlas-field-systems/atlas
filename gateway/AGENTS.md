# Working on Atlas Gateway

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The gateway app and the Fieldlinks go here. `README.md` owns the gateway app;
  each Fieldlink lives in `fieldlinks/<name>/` as its own package, with its own
  page and version, released apart from the gateway app.
- Each Fieldlink owns compact encoding, retries, duplicate handling, contact
  timing, and link security for its medium. Put those rules with that Fieldlink.
- Shared records live in `protocol/`, how a gateway talks to Core lives in
  the [Core API](../core/docs/api.md), and how radio Assets register and keep
  their IDs lives in [Runs and identity](../atlas/runs-and-identity.md). Link to
  those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
