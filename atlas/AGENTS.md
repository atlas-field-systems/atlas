# Working on the Atlas charter

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
