# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: one shared language for every part of Atlas. A Task means the same thing in Core, the SDK and the Asset.
- **`docs/adr/`**: decisions that span parts. Read the ones that touch the area you're about to work in.
- **`<part>/docs/adr/`**: decisions one part owns, such as `core/docs/adr/` or `asset/docs/adr/`. Read the ones for the part you're working in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md                 ← the one shared glossary
├── docs/
│   ├── adr/                    ← decisions that span parts
│   ├── agents/                 ← this setup
│   └── drawer/                 ← maybe-later ideas no part owns yet
├── core/docs/adr/              ← decisions Core owns
├── asset/docs/adr/             ← decisions the Asset owns
└── protocol/docs/adr/          ← decisions Protocol owns
```

A part gets its own `docs/adr/` folder only when it has a decision of its own. Each folder numbers its ADRs from `0001`. Refer to a part's ADR with its part, such as Core ADR-0002.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (lost work is never resumed), but worth reopening because…_

Only the owner accepts an ADR. An agent may write one with `status: proposed`; it becomes `accepted` when the owner decides.
