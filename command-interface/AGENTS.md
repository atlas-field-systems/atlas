# Working on Atlas Command Interface

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- How the command interface works goes here: logging in, showing Assets and their Tasks, preparing and sending Tasks and settings changes, and reading what came back.
- Write down how a decent command interface behaves. Core relies on it, so a rule that only guards Core against a misbehaving interface belongs here as interface behavior instead.
- Shared records live in `protocol/`, and how the interface talks to Core lives in the
  [Core API](../core/docs/api.md). The interface uses the [SDK](../sdk/README.md)'s
  browser client. Link to those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
