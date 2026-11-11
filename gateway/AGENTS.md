# Working on Atlas Gateway

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- The gateway app and the Fieldlinks go here: how a gateway uplinks to Core, and
  how each Fieldlink carries Atlas across its field link.
- Each Fieldlink owns compact encoding, retries, duplicate handling, contact
  timing, and link security for its medium. Put those rules with that Fieldlink.
- Shared records live in `protocol/`, and how a gateway talks to Core lives in
  the [Core API](../core/docs/api.md). Link to those rules; do not copy them.
- How radio Assets authenticate and join through a gateway is settled in
  [README](README.md). Change it only with the owner. The rest of the gateway
  design is deferred.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
