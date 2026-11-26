# Atlas Fieldlink

A Fieldlink carries Atlas across one kind of field link. It is defined by two
things: the radio hardware, and the software that runs over it. Each Fieldlink
holds both ends of its link in one folder, shipped with Atlas
([ADR-0025](../docs/adr/0025-fieldlinks-ship-with-atlas-and-hold-both-ends-of-a-link.md)):
the side a [gateway](../gateway/README.md) runs, and the side an Asset's
[communications module](../asset/docs/communications.md) runs.

**Planning.** Nothing is built.

| Fieldlink | Radio hardware | Radio software | Assets | Page |
| --- | --- | --- | --- | --- |
| Meshtastic | LoRa radios | Meshtastic firmware | Many, in a mesh | [Meshtastic](meshtastic/README.md) |

FLRC and other radios get their own Fieldlinks later. A mesh that mixes radio
types is one Fieldlink covering both.

A radio that only carries a vehicle's own protocol, with no Atlas message
crossing it, is equipment, not a Fieldlink. SiK is one: first flight uses it
through the [SiK tool](../tools/sik/README.md)
([ADR-0018](../docs/adr/0018-sik-is-equipment-used-through-an-atlas-tool-not-a-fieldlink.md)).

## How Fieldlinks fit

- **One folder per Fieldlink, shipped with Atlas.** Each Fieldlink lives in
  `fieldlink/<name>/` with both its gateway side and its Asset side, and ships
  and updates with the rest of Atlas. Separate Fieldlink releases, a gateway
  installer, and versioned plugin interfaces wait in the
  [drawer](../docs/drawer/fieldlink-packages.md).
- **One Fieldlink at a time.** A gateway or radio Asset picks one Fieldlink in
  its configuration ([Gateway](../gateway/README.md#running-fieldlinks)).
- **Clean boundaries.** A Fieldlink uses only the
  [gateway interface](../gateway/README.md#the-gateway-interface) on the gateway
  side and the [Asset link](../sdk/docs/asset.md#the-asset-link) on the Asset
  side, never the SDK directly. No other part depends on a Fieldlink's
  internals.

## Both sides run Atlas

The Asset runs the [Asset app](../asset/README.md) with the Fieldlink's Asset
side, and Atlas records cross the radio in the Fieldlink's compact encoding.
The gateway side runs on the gateway. The operator sees the same Asset as one
on IP.

## The Fieldlink moves messages; the Asset decides

A Fieldlink reports facts about its link and carries what it is given. It never
makes a decision for the Asset.

| The Fieldlink owns | The Asset owns |
| --- | --- |
| Getting messages across: encoding, retries, duplicates, end-to-end acknowledgement | The Task queue, pause, and cancel |
| Noticing the link is lost, and saying so | What to do about it: its [failsafe rules](../asset/docs/failsafes.md) |
| Asking for reports whenever it has room to send, and how much room it has, from the link and its current quality | [What to send in that room](../asset/docs/communications.md#report-from-local-state), most important first |
| Resending a must-arrive batch until it is acknowledged, or giving it back as lost so the Asset offers it again | Marking each batch must-arrive or can-skip |
| Radio identity and link security | Equipment, movement, and every other behavior |

The two sides meet only through the [Asset link](../sdk/docs/asset.md#the-asset-link).

## What every Fieldlink provides

Each Fieldlink decides how it meets these rules on its link and says how on its
own page. The rules are the same for all of them.

- **Each radio has its own identity**, made with the field link's own
  cryptography, such as a Meshtastic node's public key or a Reticulum identity.
  This **radio identity** names one radio. It stays with the gateway and its
  Fieldlink; Core never holds it.
- **No bug makes one radio speak as another.** Each Fieldlink stops this at
  the source: a frame's sender comes from the sending radio's own identity, set
  by the link itself, never from a value the Asset app or a person fills in. The
  gateway accepts a frame for `asset_id` X only when it comes from X's radio
  identity, and it rejects replayed frames. Stopping someone who holds a radio's
  keys, such as from a lost or captured radio, is not required.
- **A compact encoding may round numbers** to a fixed precision: about 1 cm
  for positions, 10 cm for altitudes, 0.01° for angles, and 1 cm/s for speeds.
  Which encoding each Fieldlink uses is its own choice.
- **Joining the field link is the Fieldlink's own step**, such as receiving a
  private channel's key. A radio that has joined can appear as a new Asset, but
  it is never taken for an Asset that is already some other radio.
- **The definitions hash is passed to Core each time a radio's link opens.**
  The Fieldlink carries the radio's hash to the gateway, and the gateway sends
  it to Core ([radio Assets](../core/docs/api.md#radio-assets)). Core refuses a
  different hash with `409 definitions_mismatch` and records
  `definitions.refused`, so no Asset is added and operators see "a radio on
  gateway G1 was refused: different definitions", as they would for an Asset on
  IP.

## Folder layout

| Path | Holds |
| --- | --- |
| `fieldlink/README.md` | This page: what every Fieldlink is and provides |
| `fieldlink/<name>/` | One Fieldlink, both its sides: its page now, its code later |

AI agents: read [AGENTS.md](AGENTS.md).
