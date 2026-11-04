# Working on the Atlas charter

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | The spec only: every Atlas data format (messages and the storage layout) as definitions, laws, examples and docs. It is what is versioned | Active |
| [core](https://github.com/atlas-field-systems/core) | Atlas Core: the server that keeps the shared picture and requests work. Now a first-flight prototype on Protocol 0.6 | Prototype |
| [sdk](https://github.com/atlas-field-systems/sdk) | The Atlas SDK: the one implementation every program uses (build, validate, parse, keys, retry, duplicates), plus transport adapters (WebSocket, Meshtastic, FLRC) | Not built yet |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core, or how bytes cross a link? Go to **sdk**.

## This repository

- **Bloat is the enemy, but good organization is not bloat.** Keep data, docs and code lean, and define nothing twice. For example, the same command kinds listed under two message types is bloat. Grouping things clearly is not.

Read [README](README.md), [the charter](CHARTER.md), and the affected story first.
This repository explains Atlas's purpose, operating environment, and how its parts
fit together.

## Ownership

Follow [document ownership](CHARTER.md#document-ownership). Keep subsystem behavior,
failure rules, and implementation plans with the owning system. Link to those docs
from the charter instead of importing them. Keep examples here focused on complete
uses of Atlas and the responsibilities of its parts.

Component repositories must point their agent instructions and overview here.
A pending proposal is not an approved contract. If subsystem docs conflict with the
operating context, identify the mismatch and resolve it explicitly with the owner.
Do not silently adopt old behavior or claim intended behavior is implemented.

## Changes

Keep selected direction, proposals, and open questions distinct. Preserve the
owner's testing simplifications. Do not turn a review suggestion into a scheduler,
Plugin platform, or other unrequested scope. Obtain the owner's agreement for
product changes and do not merge without approval.

Keep pages short and concrete. Put review transcripts and temporary plans in the
PR rather than the charter. Check relative links, anchors, whitespace, and diagram
consistency; report checks actually run. Documentation checks do not qualify runtime
behavior. Do not claim new capabilities exist merely because a story describes them.
