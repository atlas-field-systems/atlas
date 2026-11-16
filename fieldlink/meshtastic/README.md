# Meshtastic Fieldlink

The Meshtastic Fieldlink carries Atlas over LoRa radios running Meshtastic, to
many Assets in a mesh. It has a gateway side and an Asset side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages. This folder is the home for all Meshtastic-specific
documentation: radio behavior, listening and the local picture, integration
proposals, bench measurements, and historical references. Other parts link here.
Documentation location does not change which component owns runtime behavior.

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

## Listening and shared updates

**Pre-build design; not implemented.** The owner asked to bring the earlier
link's listening ideas into current docs before building. The mechanisms below
are proposals, with radio choices still subject to the
[bench measurement](../../atlas/build-order.md#new-failsafe-and-radio-decisions-wait).

### Local picture

An Asset keeps a local picture of other Assets, Observations, Tracks, and
places from readable, authenticated traffic it receives. Its modules read
that picture locally without waiting for a radio exchange. A subscription
means “keep this information coming”; an Asset can also use information it
hears without requesting it. Listening alone sends no additional traffic.

The communications module owns this picture and which heard records it keeps.
The Fieldlink supplies complete records and their verified source. Hearing
another Asset's reports does not turn them into this Asset's own measurements
or cause it to report them again as its Observations. Hearing a Task for another
Asset does not put it in this Asset's queue. Core remains the shared picture's
authority, and [following a Track](../../atlas/goal.md#kept-in-mind-for-later)
remains future work.

The picture is partial: silence does not mean an item was deleted. Records keep
their original source and measurement time, separate from when they were heard.
A repeated or relayed report must not appear fresher, and a delayed older update
must not replace newer evidence. An incomplete or unverifiable record is skipped.
Hearing a peer does not establish contact with Core. The picture follows the
Asset's existing [run and restart boundaries](../../asset/docs/README.md#start-and-connect).

Still to design: the local read and subscription interfaces; which records are
useful to keep; ordering and deletion handling; freshness and memory limits;
and how [local evidence](../../asset/docs/logging.md) records what was heard and used. The old
link's file-based cache, TTLs, and version fields are not selected contracts.

### One transmission can serve several listeners

Reports an Asset already sends toward its gateway can also be readable by
listening peers. Gateway-originated updates carry Core's picture, including
Tracks and places. Both paths can feed a listener's local picture.

Asset A asks to keep a Track current. The gateway sends an update on the shared
link. A and B can both keep that update, even if B did not ask for it. If B
later needs continuing updates, it subscribes too. This saves sending the same
update separately for each listener; requested updates and any repairs still
cost airtime.

- **Readable shared traffic.** Use a shared transmission path for picture
  updates that other authorized listeners can read. The historical implementation
  deliberately broadcast these updates. Do not assume a radio exposes unicast
  traffic addressed to another node, or that peers can read its encrypted
  direct messages. Confirm the selected firmware's receive path on the bench.
- **Authenticated sources.** A listener needs proof of the sender and replay
  rejection, not just knowledge of the channel key. Select the authentication
  and encryption together so shared readability does not weaken identity.
  Definitions compatibility also applies before passing a record to the Asset.
- **Combined interests.** The gateway combines Assets' subscriptions and sends
  each relevant change once for listeners to share. A new interest needs the
  current record as well as later updates. Subscription lifetime, renewal,
  removal, and recovery after disconnection remain to be designed.
- **Existing delivery responsibilities.** Picture subscriptions do not replace
  Task delivery or acknowledgements of final reports. Overhearing is not an
  acknowledgement on behalf of a recipient, nor proof that Core stored a report.
  A passive listener does not request a retransmission merely because it missed
  an update. Active subscription recovery must fit the available airtime.

Picture reads and subscription aggregation go through the
[gateway interface](../../gateway/README.md#the-gateway-interface). The exact
interface is open; the Fieldlink still never calls the SDK directly. The
current [Asset link](../../sdk/docs/asset.md#the-asset-link) does not expose
local-picture reads or subscriptions; that extension is also not designed yet.

### Options to measure

- **Discovery index.** Advertise which picture records are available so an
  Asset can request details without first receiving the whole picture. Measure
  whether the index saves airtime for actual consumers before selecting it.
- **Changes with full-record recovery.** Compact updates could avoid repeating
  unchanged data. A listener missing the required base skips a change until it
  can recover a complete record. Full snapshots could repair gaps, including
  for passive listeners. Encoding, ordering, recovery triggers, and their cost
  are open; this does not add version fields to Protocol records.

### Scenarios to verify

- A peer keeps an Asset report already traveling to the gateway without sending
  a request, acknowledging for the gateway, or reporting it as its own observation.
- Two Assets interested in the same record receive one shared update; a third
  listener can keep it without causing another transmission.
- A new subscriber gets the current record. Ended interests stop generating
  updates when no remaining subscriber needs them.
- A listener misses an update or a snapshot base, then recovers without
  presenting incomplete data or an old measurement as new.
- Spoofed, replayed, incompatible, and incomplete records never enter the local
  picture; a valid duplicate does not change its measurement time.
- A busy picture stream still allows Tasks and must-arrive reports through,
  and hearing peers while the gateway is unreachable does not restore Core contact.

### Historical source

The retired link's [overhearing design](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/docs/OPPORTUNISTIC_OVERHEARING.md),
[Asset receive path](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/src/atlas_meshtastic_link/asset/runner.py#L127),
and [gateway broadcasts](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/src/atlas_meshtastic_link/gateway/operations/runtime.py#L279)
are design references, not current contracts. Its listening path was wired, but
its documented version ordering and cache expiry were incomplete. Its domain
records, provisioning exchange, and reliability guarantees are not adopted here.

## Radio measurement

While this Fieldlink is built, two Meshtastic radios are connected to the build
computer and send messages to each other. Their measured numbers belong in this
folder, and the simulated radio link uses them. This is the
[decided bench work](../../atlas/decision-log.md#build-and-test), not completed evidence.

How much Meshtastic carries in practice after relays and acknowledgements is
unknown. Measure the available airtime before selecting how the link
[asks the Asset for reports](../../asset/docs/communications.md#report-from-local-state).
Radio settings trade capacity against range; the bench measurement establishes
capacity under its tested conditions, not field range.

## Not designed yet

- How listeners verify radio-to-Asset attribution and the current run, including
  across a gateway restart or Core Reset.
- The compact encoding, frame size, retry timing, and contact timing.
- How the Fieldlink works out how much room it has before it
  [asks the Asset for reports](../../asset/docs/communications.md#report-from-local-state).
  Meshtastic firmware reports how full its send queue is and how busy the
  channel is, and a packet's airtime follows from the radio settings. Which of
  these it uses waits for the bench measurement.
- How much the link carries in practice, measured with two radios on the bench
  ([radio measurement](#radio-measurement)).

AI agents: read [the Fieldlink AGENTS.md](../AGENTS.md).
