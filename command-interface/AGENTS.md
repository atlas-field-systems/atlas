# Working on Atlas Command Interface

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- How the command interface works goes here: connecting, showing Assets and their Tasks, picking `task_id`s, sending commands and settings, and reading what came back.
- Protocol calls this part an operator interface (`admin.operator_hello`). Keep that name for the messages.
- Write down how a decent command interface behaves. Core relies on it, so a rule that only guards Core against a misbehaving interface belongs here as interface behavior instead.
- Message and storage formats live in `protocol/`, and how an interface talks to Core lives in `protocol/sdk/`. Link to those rules; do not copy them.
- Planning only: no code until the owner asks. Do not merge without the developer's approval.
