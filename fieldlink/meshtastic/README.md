# Meshtastic Fieldlink

The Meshtastic Fieldlink carries Atlas over LoRa radios running Meshtastic, to
many Assets in a mesh. It has a gateway side and an Asset side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages; this page owns only what is particular to Meshtastic.

**Planning.** Nothing is built.

## Hardware and software

- **Radio hardware.** A LoRa radio running Meshtastic, plugged into the gateway
  computer, and one on each Asset, plugged into the computer that runs its
  Asset app.
- **Radio software.** Meshtastic firmware: a private channel, a private app
  port, and Meshtastic's encryption, routing, and per-hop acknowledgements.

## Gateway and Asset

This is a [gateway-and-Asset Fieldlink](../README.md#two-kinds-of-fieldlink):
each Asset runs the Asset app with this package's Asset side. On top of Meshtastic, the
Fieldlink adds end-to-end acknowledgement of Tasks and final reports,
idempotency by `task_id`, and per-Asset contact reports to Core. Protocol defines
no short keys, so the Fieldlink chooses its own compact encoding. The gateway's
link to Core is broadband IP, so the gateway keeps its Assets' full state and
sends over the radio only what each Asset does not already have.

## How it meets [what every Fieldlink provides](../README.md#what-every-fieldlink-provides)

- **Radio identity.** Each Meshtastic node's public key.
- **Only that radio speaking.** The gateway accepts a frame for an Asset only
  from that Asset's node key, and rejects replays.
- **Joining.** Receiving the private channel's key.
- **Definitions hash.** Each radio sends its hash when its link opens, and the
  gateway compares it with its own.

## Not designed yet

- The compact encoding, frame size, retry timing, and contact timing.
- How many Assets the link carries in practice.

AI agents: read [the Fieldlink AGENTS.md](../AGENTS.md).
