# Atlas Tools

An Atlas Tool is a ready setup for one kind of equipment. It packages existing
Atlas parts, such as the [Asset app](../asset/README.md), with the glue that
equipment needs, so a person can put it in the field without assembling the
parts by hand.

- **A Tool adds no Atlas part.** It uses the parts as they are and changes none
  of their behavior. What the Asset does, how it reaches Core, and its failsafes
  stay with those parts' pages.
- **A Tool is not a [Fieldlink](../fieldlink/README.md).** It carries no Atlas
  messages over a field link. Its glue only connects an Atlas part to the
  equipment's own protocol.
- **No part depends on a Tool.** Removing one breaks nothing else in Atlas.

**Planning.** Nothing is built.

| Tool | Equipment | What it runs | Page |
| --- | --- | --- | --- |
| SiK | A MAVLink vehicle over a SiK telemetry radio pair | The Asset app on a ground Raspberry Pi, and a MAVLink adapter to the radio | [SiK](sik/README.md) |

## Folder layout

| Path | Holds |
| --- | --- |
| `tools/README.md` | This page: what every Atlas Tool is |
| `tools/<name>/` | One Tool: its page now, its setup files later |

AI agents: read [AGENTS.md](AGENTS.md).
