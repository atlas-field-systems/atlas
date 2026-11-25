---
status: accepted
date: 2026-11-13
---

# Fieldlinks are separate packages that hold both ends of a link

Each Fieldlink is an independently released package defined by its radio hardware and software. It holds both the gateway end and the Asset end. SiK is not a Fieldlink ([ADR-0018](0018-sik-is-equipment-used-through-an-atlas-tool-not-a-fieldlink.md)).

On each gateway, the admin chooses one Fieldlink at a time and installs or updates it in one action from the text screen or CLI. Separate packages let Fieldlinks update without new gateway software. The gateway's stable interface is built on the SDK, so SDK updates need no Fieldlink changes.

Rules: [Packages and versions](../../fieldlink/README.md#packages-and-versions), [Installing and running Fieldlinks](../../gateway/README.md#installing-and-running-fieldlinks), [The gateway interface](../../gateway/README.md#the-gateway-interface)
