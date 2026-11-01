# Working on the Atlas charter

Read [README](README.md), [the charter](CHARTER.md), and the affected story first.
This repository contains product documentation, not implementation.

## Ownership

Follow the [document ownership](CHARTER.md#document-ownership) order. Put product
behavior here, exact shared contracts in Protocol, and mechanisms in their owning
components. Link to the authoritative definition instead of copying it.

Component repositories must point their agent instructions and overview here.
A pending proposal is not an approved contract. If stories and implementation
contracts disagree, identify the mismatch; do not silently adopt old behavior or
claim the new behavior is implemented.

## Changes

Keep selected direction, proposals, and open questions distinct. Preserve the
owner's testing simplifications. Do not turn a review suggestion into a scheduler,
Plugin platform, or other unrequested scope. Obtain the owner's agreement for
product changes and do not merge without approval.

Keep pages short and concrete. Put review transcripts and temporary plans in the
PR rather than the charter. Check relative links, anchors, whitespace, and diagram
consistency; report checks actually run. Documentation checks do not qualify runtime
behavior. Do not claim new capabilities exist merely because a story describes them.
