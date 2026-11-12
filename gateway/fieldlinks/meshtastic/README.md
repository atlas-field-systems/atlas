# Meshtastic Fieldlink

The Meshtastic Fieldlink carries Atlas over LoRa radios running Meshtastic, to
many Assets in a mesh. The [gateway app](../../README.md) owns everything every
mode shares; this page owns only what is particular to Meshtastic.

**Planning.** Nothing is built.

## Hardware and software

- **Radio hardware.** A LoRa radio running Meshtastic, plugged into the gateway
  computer, and one on each Asset, plugged into the computer that runs its
  Asset app.
- **Radio software.** Meshtastic firmware: a private channel, a private app
  port, and Meshtastic's encryption, routing, and per-hop acknowledgements.

## It carries Atlas to the Asset

This Fieldlink [carries Atlas to the Asset](../../README.md#fieldlinks-are-the-gateways-operating-modes):
each Asset runs the Asset app with this same package. On top of Meshtastic, the
Fieldlink adds end-to-end acknowledgement of Tasks and final reports,
idempotency by `task_id`, and per-Asset contact reports to Core. Protocol defines
no short keys, so the Fieldlink chooses its own compact encoding. The gateway's
link to Core is broadband IP, so the gateway keeps its Assets' full state and
sends over the radio only what each Asset does not already have.

## How it meets what every Fieldlink provides

- **Radio identity.** Each Meshtastic node's public key.
- **Only that radio speaking.** The gateway accepts a frame for an Asset only
  from that Asset's node key, and rejects replays.
- **Joining.** Receiving the private channel's key.
- **Definitions hash.** Each radio sends its hash when its link opens, and the
  gateway compares it with its own.

## Not designed yet

- The compact encoding, frame size, retry timing, and contact timing.
- How many Assets the link carries in practice.

AI agents: read [the gateway's AGENTS.md](../../AGENTS.md).
