# Atlas Fieldlink

A Fieldlink carries Atlas across one kind of field link. It is defined by two
things: the radio hardware, and the software that runs over it. Each Fieldlink
holds both ends of its link in one package: the side a
[gateway](../gateway/README.md) runs, and the side an Asset's
[communications module](../asset/docs/communications.md) runs.

**Planning.** Nothing is built.

| Fieldlink | Radio hardware | Radio software | Sides | Assets | Page |
| --- | --- | --- | --- | --- | --- |
| SiK | A SiK telemetry radio pair | MAVLink | Gateway only | One vehicle | [SiK](sik/README.md) |
| Meshtastic | LoRa radios | Meshtastic firmware | Gateway and Asset | Many, in a mesh | [Meshtastic](meshtastic/README.md) |

FLRC and other radios get their own Fieldlinks later. A mesh that mixes radio
types is one Fieldlink covering both.

## Packages and versions

- **Each Fieldlink is its own package** with its own version, released on its
  own from `prod`, so updating a Fieldlink never needs a new gateway app or
  Asset app. Publishing is set up when the first one has code.
- **A gateway installs it with one action** from its install screen, and runs
  one at a time ([Gateway](../gateway/README.md#installing-and-running-fieldlinks)).
  An Asset app installs the Asset side the same way.
- **It states which interface versions it works with**: the
  [gateway interface](../gateway/README.md#the-gateway-interface) on the gateway
  side and the [Asset link](../sdk/docs/asset.md#the-asset-link) on the Asset
  side. A Fieldlink never calls the SDK directly, so an SDK update does not
  touch any Fieldlink.

## Two kinds of Fieldlink

- **Gateway and Asset.** The Asset runs the [Asset app](../asset/README.md) with
  this Fieldlink's Asset side, and Atlas records cross the radio in the
  Fieldlink's compact encoding. Meshtastic works this way.
- **Gateway only.** The vehicle speaks only its own protocol, such as MAVLink,
  and runs no Atlas software. The Fieldlink runs on the gateway alone. Through
  the gateway interface, the gateway runs the standard Asset app for the
  vehicle, and the Fieldlink hands the radio connection to that app's
  [equipment driver](../asset/docs/assets.md#modules-and-equipment-drivers),
  which turns the vehicle's stream into Atlas reports and Tasks into vehicle
  commands. SiK works this way.

Either way the operator sees the same Asset.

## The Fieldlink moves messages; the Asset decides

A Fieldlink reports facts about its link and carries what it is given. It never
makes a decision for the Asset.

| The Fieldlink owns | The Asset owns |
| --- | --- |
| Getting messages across: encoding, retries, duplicates, end-to-end acknowledgement | The Task queue, pause, and cancel |
| Noticing the link is lost, and saying so | What to do about it: its [failsafe rules](../asset/docs/failsafes.md) |
| Saying how much the link can carry now | [What to send within that](../asset/docs/communications.md#report-from-local-state), and how often |
| Sending must-arrive messages before can-skip ones | Marking each message must-arrive or can-skip |
| Radio identity and link security | Equipment, movement, and every other behavior |

The two sides meet only through the [Asset link](../sdk/docs/asset.md#the-asset-link).

## What every Fieldlink provides

Each Fieldlink decides how it meets these rules on its link and says how on its
own page. The rules are the same for all of them.

- **Each radio has its own identity**, made with the field link's own
  cryptography, such as a Meshtastic node's public key or a Reticulum identity.
  This **radio identity** names one radio. It stays with the gateway and its
  Fieldlink; Core never holds it.
- **Only that radio can speak as its Asset.** The gateway accepts a frame for
  `asset_id` X only when it comes from X's radio identity, and it rejects
  replayed frames. A shared channel key alone is not enough: another radio, or
  anyone holding a leaked channel key, must not be able to pretend to be X.
- **Joining the field link is the Fieldlink's own step**, such as receiving a
  private channel's key. A radio that has joined can appear as a new Asset, but
  it can never speak as an Asset that is already some other radio.
- **The definitions hash is checked each time a radio's link opens.** A
  gateway-and-Asset Fieldlink compares the radio's hash with the gateway's. A
  gateway-only Fieldlink runs the Asset app on the gateway with the gateway's
  own definitions, so there is nothing to compare. A radio with different
  definitions is refused and not added as an Asset; operators see "a radio on
  gateway G1 was refused: different definitions", as they would for an Asset on
  IP.

## Folder layout

| Path | Holds |
| --- | --- |
| `fieldlink/README.md` | This page: what every Fieldlink is and provides |
| `fieldlink/<name>/` | One Fieldlink package, both its sides: its page now, its code later |

AI agents: read [AGENTS.md](AGENTS.md).
