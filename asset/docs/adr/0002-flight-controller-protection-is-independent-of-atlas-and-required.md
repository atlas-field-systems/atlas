---
status: accepted
date: 2026-11-15
---

# Flight-controller protection is independent of Atlas and required

Every flying Asset must have independent flight-controller protection, because the Atlas app cannot act if the app or its computer fails. Core also refuses Tasks to a flying Asset that has no Atlas critical battery rule.

Starting battery defaults are 35% for Atlas return, 15% for independent flight-controller return, and 10% for both layers to land in place as a last resort. The flight controller also defaults to returning home after 5 seconds without hearing from the app. Each Asset can change these values. Returning home is preferred over landing in place.

After a pilot or flight-controller takeover, operators can only watch until a person hands control back. If an earlier Atlas request puts the vehicle back into Atlas's mode in the meantime, Atlas switches it back to the mode the pilot or flight controller chose and keeps watching.

Rules: [No rules are enabled by default](../failsafes.md#no-rules-are-enabled-by-default), [Independent flight-controller protections](../failsafes.md#independent-flight-controller-protections), [While the flight controller is in control](../failsafes.md#while-the-flight-controller-is-in-control)
