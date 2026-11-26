---
status: accepted
date: 2026-11-25
---

# SiK is equipment, used through an Atlas Tool, not a Fieldlink

SiK is not a Fieldlink. It is used through the SiK tool, the first Atlas Tool. A ground Raspberry Pi runs the standard Asset app, which reaches Core through the SDK over IP, and an adapter bridges that app's MAVLink to a SiK radio pair wired to the flight controller.

Why: the Pi runs the Asset itself, and SiK only carries MAVLink to the vehicle. No Atlas message crosses the radio, so a gateway adds nothing, and first flight needs no gateway. Meshtastic stays the first real Fieldlink.

An Atlas Tool packages existing parts and the glue for one kind of equipment. It carries no Atlas messages over a field link, and no part depends on it.

Rules: [Atlas Tools](../../tools/README.md), [SiK tool](../../tools/sik/README.md), [First flight](../../atlas/first-flight.md)
