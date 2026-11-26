---
status: accepted
date: 2026-11-26
---

# Fieldlinks ship with Atlas and hold both ends of a link

Each Fieldlink stays one folder under `fieldlink/<name>/` holding both ends of its link (the gateway side and the Asset side), defined by its radio hardware and software, and ships with the rest of Atlas. No other part depends on a Fieldlink's internals: a gateway runs one configured Fieldlink at a time through the gateway interface, and a radio Asset runs its side through the Asset link. SiK is not a Fieldlink ([ADR-0018](0018-sik-is-equipment-used-through-an-atlas-tool-not-a-fieldlink.md)).

Separate Fieldlink releases, a gateway installer (text menus, CLI, and USB installs), and separately versioned plugin interfaces wait in the [drawer](../drawer/fieldlink-packages.md).

Why: separate releases, an installer, and versioned plugin interfaces are too heavy for one tester with no Fieldlink built, and updating Atlas is already a full Reset where every part updates together.

Supersedes ADR-0009.

Rules: [How Fieldlinks fit](../../fieldlink/README.md#how-fieldlinks-fit), [Running Fieldlinks](../../gateway/README.md#running-fieldlinks), [The gateway interface](../../gateway/README.md#the-gateway-interface)
