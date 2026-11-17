# Meshtastic Fieldlink

The Meshtastic Fieldlink is sketched to carry Atlas over LoRa radios running
Meshtastic, to many Assets in a mesh, with a gateway side and an Asset side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages. This folder is the home for all Meshtastic-specific
documentation: radio behavior, listening and the local picture, integration
proposals, bench measurements, and historical references. Other parts link here.
Documentation location does not change which component owns runtime behavior.

**Documentation only for now.** Nothing is built. The owner has left this as
reference material and potential concepts for future use. The existing sketch
below records the intended link; the optional concepts are listed separately.

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

## Potential concepts

These ideas from earlier Meshtastic work are options we could use. None is
selected for implementation or a decision that must be settled before a build.
They can be considered separately if work resumes.

### Listening and shared updates

- **Passive listening.** An Asset could use readable, authenticated reports
  already traveling from peers to the gateway, without requesting extra traffic.
- **Local picture.** An Asset could retain selected heard records for its
  modules to read locally, without waiting for a radio exchange.
- **Shared updates.** A gateway could broadcast a Core picture update once for
  several authorized listeners, including Assets that did not request it.
- **Combined subscriptions.** The gateway could combine requests to keep the
  same record current, send a current snapshot to a new subscriber, and stop
  updates when no subscriber needs them.
- **Discovery index.** A compact list of available records could let Assets
  request details without receiving the whole picture first.
- **Changes with full-record recovery.** Compact updates could avoid repeating
  unchanged data; complete snapshots could repair missing updates or bases,
  including for passive listeners.

For example, A could subscribe to a Track while B merely listens. Both could
keep the gateway's shared update. B would subscribe only if it needed continued
updates itself. Requested updates and repairs would still cost airtime.

### Local picture

If adopted, a local picture could hold other Assets, Observations, Tracks, and
places. The communications module would own it and select which heard records
to keep; the Fieldlink would supply complete records and their verified source.
Hearing another Asset's reports does not turn them into this Asset's own measurements
or cause it to report them again as its Observations. Hearing a Task for another
Asset does not put it in this Asset's queue. Core remains the shared picture's
authority, and [following a Track](../../atlas/goal.md#kept-in-mind-for-later)
remains future work.

Such a picture would be partial: silence would not mean an item was deleted.
Records would need to keep their original source and measurement time, separate
from when they were heard. A repeated or relayed report must not appear fresher,
and a delayed older update must not replace newer evidence. An incomplete or
unverifiable record is skipped.
Hearing a peer does not establish contact with Core. Any picture must respect the
Asset's existing [run and restart boundaries](../../asset/docs/README.md#start-and-connect).

Questions if selected: useful records, local read interfaces, ordering,
deletion handling, freshness, memory limits, and how
[local evidence](../../asset/docs/logging.md) records what was heard and used.
The old link's file-based cache, TTLs, and version fields are not selected contracts.

### Considerations if selected

- **Readable shared traffic.** Shared updates would need a transmission path
  that other authorized listeners can read. The historical implementation
  deliberately broadcast these updates. Do not assume a radio exposes unicast
  traffic addressed to another node, or that peers can read its encrypted
  direct messages. A candidate firmware's receive path would need bench verification.
- **Authenticated sources.** A listener needs proof of the sender and replay
  rejection, not just knowledge of the channel key. Authentication and encryption
  would need to preserve identity while allowing shared readability.
  Definitions compatibility also applies before passing a record to the Asset.
  Radio-to-Asset attribution and run boundaries would need to hold across
  gateway restarts and Core Reset.
- **Subscription lifecycle.** Subscription lifetime, renewal, removal, and
  recovery after disconnection are open questions if subscriptions are adopted.
- **Existing delivery responsibilities.** Picture subscriptions do not replace
  Task delivery or acknowledgements of final reports. Overhearing is not an
  acknowledgement on behalf of a recipient, nor proof that Core stored a report.
  A passive listener does not request a retransmission merely because it missed
  an update. Active subscription recovery must fit the available airtime.

Any picture reads and subscription aggregation would go through the
[gateway interface](../../gateway/README.md#the-gateway-interface). The exact
interface is open; the Fieldlink still never calls the SDK directly. The
current [Asset link](../../sdk/docs/asset.md#the-asset-link) does not expose
local-picture reads or subscriptions; no extension is selected here.

Discovery indexes and compact changes would need measurements showing that
they save airtime for actual consumers. A listener missing a change's base
would need to skip it until a complete record could be recovered. Encoding,
ordering, recovery triggers, and their cost are open; this does not add
version fields to Protocol records. Radio choices remain subject to the
[existing measurement decision](../../atlas/build-order.md#new-failsafe-and-radio-decisions-wait).

### Possible evaluation scenarios

If a concept is taken up, these scenarios could help evaluate it:

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

When this Fieldlink is built, two Meshtastic radios are connected to the build
computer and send messages to each other. Their measured numbers belong in this
folder, and the simulated radio link uses them. This is the
[decided bench work](../../atlas/decision-log.md#build-and-test), not completed evidence.

How much Meshtastic carries in practice after relays and acknowledgements is
unknown. Measure the available airtime before selecting how the link
[asks the Asset for reports](../../asset/docs/communications.md#report-from-local-state).
Radio settings trade capacity against range; the bench measurement establishes
capacity under its tested conditions, not field range.

## Open engineering questions

These questions remain for a future build; they are not work scheduled now.

- The compact encoding, frame size, retry timing, and contact timing.
- How the Fieldlink works out how much room it has before it
  [asks the Asset for reports](../../asset/docs/communications.md#report-from-local-state).
  Meshtastic firmware reports how full its send queue is and how busy the
  channel is, and a packet's airtime follows from the radio settings. Which of
  these it uses waits for the bench measurement.
- How much the link carries in practice, measured with two radios on the bench
  ([radio measurement](#radio-measurement)).

AI agents: read [the Fieldlink AGENTS.md](../AGENTS.md).
