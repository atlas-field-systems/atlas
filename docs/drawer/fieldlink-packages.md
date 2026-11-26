# Separate Fieldlink packages and gateway installer

**Keep room.** Fieldlinks ship with Atlas
([ADR-0025](../adr/0025-fieldlinks-ship-with-atlas-and-hold-both-ends-of-a-link.md)).
Separate Fieldlink releases, a gateway installer, and versioned plugin
interfaces wait here.

## Ideas to keep

- **Independent releases.** Each Fieldlink could be released on its own with its
  own version, so updating a radio link would not require a new gateway app or
  Asset app.
- **One-action installer.** A gateway console text screen (TUI) and plain CLI
  commands could list published Fieldlinks, fetch packages with checksum checks
  when online, or install from a local package file such as a USB stick when
  offline, with the same install flow on the Asset side.
- **Versioned plugin interfaces.** The gateway interface and the Asset link
  could carry explicit interface versions so each Fieldlink states which
  versions it works with and the gateway app refuses an incompatible package.

Out of the drawer when: multiple Fieldlinks are in active use and updating them
apart from the rest of Atlas justifies maintaining an installer and versioned
plugin interfaces.
