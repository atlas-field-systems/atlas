---
status: accepted
date: 2026-11-13
---

# Fieldlinks are separate packages that hold both ends of a link

Each Fieldlink is an independently released package defined by its radio hardware and software. It holds both the gateway end and the Asset end. SiK has only a gateway end because its vehicle runs no Atlas software.

On each gateway, the admin chooses one Fieldlink at a time and installs or updates it in one action from the text screen or CLI. Separate packages let Fieldlinks update without new gateway software. The gateway's stable interface is built on the SDK, so SDK updates need no Fieldlink changes.

Rules: [Packages and versions](../../fieldlink/README.md#packages-and-versions), [Two kinds of Fieldlink](../../fieldlink/README.md#two-kinds-of-fieldlink), [Installing and running Fieldlinks](../../gateway/README.md#installing-and-running-fieldlinks), [The gateway interface](../../gateway/README.md#the-gateway-interface)
