# Working on the Atlas charter

## Atlas repositories

Atlas is split across a few repositories. This map is the same in each of them.
If you need something outside this repository, go to the one that owns it.

| Repository | What lives there | Status |
|---|---|---|
| [atlas](https://github.com/atlas-field-systems/atlas) | The Charter: what Atlas is for, how it is used, project-wide design decisions | Active |
| [protocol](https://github.com/atlas-field-systems/protocol) | Every Atlas data format: messages and the storage layout, with definitions, checks and a viewer | Active |
| [core](https://github.com/atlas-field-systems/core) | The new Atlas Core: the server that keeps the shared picture and requests work | Not started |
| [sdk](https://github.com/atlas-field-systems/sdk) | The Atlas SDK: client library for gateways, Assets and apps, including the Core-to-gateway API | Not started |

- Want to know why Atlas exists, how it is used, or a project-wide rule? Go to **atlas**.
- Want the exact shape of a message or of stored data? Go to **protocol**.
- Want how Core works inside? Go to **core**.
- Want how a gateway, Asset or app talks to Core? Go to **sdk**.

## This repository

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
