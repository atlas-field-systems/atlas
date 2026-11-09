# Experimental ideas

These ideas are worth exploring. They are **experimental and not committed**.
Nothing here is a requirement until it moves into another Charter page.

## Ground elevation at connect

Some Assets know their height above their launch point but not above sea level.
When an Asset connects to Core and knows it is on the ground, it can ask Core
for the ground elevation at its position.
Because the Asset is on the ground, that elevation is its altitude above sea level.
From then on, the Asset can report altitude above sea level as well as above its launch point.

The elevation comes from a Plugin that offers the `ground_elevation` action
(see [Plugins](plugins.md#ground-elevation-for-an-asset-later)). Only operators
can call Plugins for now, so this waits until Assets can.

Open question: how accurate the elevation must be.

## Links, not just messages

Every Atlas connection is now a two-way stream, like a WebSocket. So a radio's job
is to keep a live link up between radios, not just to deliver single messages
from A to B. This may become its own Charter section later.

Open questions: how a radio link is set up and kept stable, how it reroutes when
the mesh changes, how it copes with Assets moving, and what to call the stream
idea, since it spans WebSocket and radio links.

Naming is still open for the always-open connection idea: "session" fits because
the link stays open; "link" feels too generic.

## Passive listening

On broadcast radio links (FLRC, LoRa; not IP), Assets can listen to traffic that
is already on the air and build a passive picture of the operation without asking
Core. For example:

- An Asset told to follow a Track it cannot see listens to another Asset's
  observation reports on that Track and steers itself.
- An Asset follows another Asset by hearing its status and position reports.

The radio channel is shared: every Asset on it can read what the others send.
Channel membership is the trust boundary. Atlas does not authenticate individual
overheard messages, because keys travel only in the hello.

A passive picture behaves like this:

- **Listening sends nothing.** Hearing a message never causes a query,
  acknowledgement, subscription, or rebroadcast.
- **Hearing is not authorization.** A Task or command addressed to another Asset
  is information only.
- **Age stays honest.** Each entry keeps its source and measurement time. Hearing
  it again does not make it fresh. An entry too old to follow becomes unusable.
- **Partial stays partial.** A listener that joined late never claims a complete
  picture, and not hearing an update does not prove a record was removed.
- **It is bounded.** Entries and memory have limits.

Core's WebSocket push to an operator interface is ordinary delivery, not overhearing.
Who owns the passive picture, its limits, and its expiry rules remain open.
A gateway rebroadcasting Core's picture over radio for Assets is a separate,
larger idea and is not part of passive listening.

### Past radio link work

Earlier Atlas projects tried this. The source was inspected, not run.

- **Python Meshtastic link** ([runner][py-runner], [sync][py-sync]): fed overheard
  peer reports and gateway updates into one local world picture with source and
  receipt time. It did not order records by version or prune old passive entries,
  despite its docs.
- **TypeScript Meshtastic link** ([picture][ts-picture], [transport][ts-transport]):
  a bounded picture keeping source, measurement and receipt times, rejecting stale
  sequences, and separating overheard traffic from traffic addressed to the Asset.
  Its transport replaced obsolete unsent state, reconsidered priority between
  chunks, and shared one subscription between local consumers.
- **MeshCore FieldLink** ([status][fl-status], [node][fl-node]): checked the radio's
  queue depth before sending, used high, normal and bulk priorities, and repaired
  only missing chunks. Its passive picture was planned, not built.

Replacing obsolete unsent state, priority between chunks, and selective repair
are candidate radio behaviors, where the radio does not already provide them.
None is selected.

[py-runner]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Client_SDKs/connection_packages/next_gen_atlas_meshtastic_link/src/atlas_meshtastic_link/asset/runner.py
[py-sync]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Client_SDKs/connection_packages/next_gen_atlas_meshtastic_link/src/atlas_meshtastic_link/asset/sync.py
[ts-picture]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/packages/meshtastic-link/src/picture.ts
[ts-transport]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/packages/meshtastic-link/src/transport.ts
[fl-status]: https://github.com/the-Drunken-coder/Atlas-FieldLink/blob/49be26234d7829a9199e49810e4236b71a98007c/README.md
[fl-node]: https://github.com/the-Drunken-coder/Atlas-FieldLink/blob/49be26234d7829a9199e49810e4236b71a98007c/src/node.ts
