# Meshtastic listening and local picture

Ideas from earlier Meshtastic work. None is selected or required before a build.
Out of the drawer when: a Meshtastic build needs one of them, or the owner drops them.

## Listening and shared updates

- **Passive listening.** An Asset could use readable, authenticated reports
  already heading from peers to the gateway, without requesting extra traffic.
- **Local picture.** An Asset could keep selected heard records so its modules
  can read them locally without waiting for a radio exchange.
- **Shared updates.** A gateway could broadcast a Core picture update once for
  several authorized listeners, including Assets that did not ask for it.
- **Combined subscriptions.** The gateway could merge requests for the same
  record, send a current snapshot to a new subscriber, and stop updates once no
  subscriber needs them.
- **Discovery index.** A compact list of available records could let Assets ask
  for details without pulling the whole picture first.
- **Changes with full-record recovery.** Compact updates could skip repeating
  unchanged data. Complete snapshots could repair missed updates or missing
  bases, including for passive listeners.

For example, A could subscribe to a Track while B only listens. Both could keep
the gateway's shared update, and B would subscribe only if it needed continued
updates on its own. Requested updates and repairs would still cost airtime.

## Local picture

If adopted, a local picture could hold other Assets, Observations, Tracks, and
places. The communications module would own it and choose which heard records to
keep. The Fieldlink would supply complete records and their verified source.

Hearing another Asset's reports does not make them this Asset's own
measurements, and does not make it report them again as its own Observations.
Hearing a Task for another Asset does not add it to this Asset's queue. Core
stays the authority for the shared picture, and
[following a Track](follow-a-track.md) remains future work.

A local picture would always be partial. Silence would not mean an item was
deleted. Records would keep their original source and measurement time, separate
from when they were heard. A repeated or relayed report must not look newer, and
a delayed older update must not overwrite newer evidence. Incomplete or
unverifiable records are skipped. Hearing a peer does not count as contact with
Core, and any local picture must respect the Asset's
[run and restart boundaries](../../asset/docs/README.md#start-and-connect).

Open questions if selected include which records are useful, local read
interfaces, ordering, deletion handling, freshness, memory limits, and how
[local evidence](../../asset/docs/logging.md) records what was heard and used.
The old link's file-based cache, TTLs, and version fields are not selected
contracts.

## Considerations if selected

- **Readable shared traffic.** Shared updates need a transmission path that
  other authorized listeners can read. The historical link deliberately
  broadcast these updates. Do not assume a radio exposes unicast traffic sent to
  another node, or that peers can read encrypted direct messages. Any candidate
  firmware's receive path needs bench verification.
- **Authenticated sources.** Listeners need the sender's radio identity, just as
  the gateway gets it, plus replay rejection. Authentication and encryption must
  preserve identity while still letting authorized peers read shared traffic.
  Definitions compatibility still applies before passing a record to the Asset.
  Radio-to-Asset attribution and run boundaries must hold across gateway
  restarts and Core Reset.
- **Subscription lifecycle.** Subscription lifetime, renewal, removal, and
  recovery after disconnection stay open if subscriptions are adopted.
- **Existing delivery responsibilities.** Picture subscriptions do not replace
  Task delivery or acknowledgements of final reports. Overhearing is neither an
  acknowledgement for a recipient nor proof that Core stored a report. Passive
  listeners do not ask for retransmissions just because they missed an update.
  Active subscription recovery must fit available airtime.

Any picture reads and combined subscriptions would go through the
[gateway interface](../../gateway/README.md#the-gateway-interface). That
interface is open, and the Fieldlink still never calls the SDK directly. The
current [Asset link](../../sdk/docs/asset.md#the-asset-link) does not expose
local-picture reads or subscriptions, and no extension is selected here.

Discovery indexes and compact changes need measurements proving they save
airtime for real consumers. A listener missing a change's base would skip it
until it could recover a complete record. Encoding, ordering, recovery triggers,
and their cost stay open, and this adds no version fields to Protocol records.
Radio choices remain subject to the
[existing measurement decision](../../atlas/build-order.md#new-failsafe-and-radio-decisions-wait).

## Possible evaluation scenarios

If a concept is taken up, these scenarios could help evaluate it.

- A peer keeps an Asset report already heading to the gateway without sending a
  request, acknowledging for the gateway, or reporting it as its own
  Observation.
- Two Assets interested in the same record receive one shared update, and a
  third listener keeps it without triggering another transmission.
- A new subscriber gets the current record. Updates stop once no remaining
  subscriber needs them.
- A listener misses an update or a snapshot base, then recovers without showing
  incomplete data or treating an old measurement as new.
- Spoofed, replayed, incompatible, and incomplete records never enter the local
  picture. A valid duplicate does not change the measurement time.
- A busy picture stream still lets Tasks and must-arrive reports through, and
  hearing peers while the gateway is unreachable does not restore Core contact.

## Historical source

The retired link's
[overhearing design](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/docs/OPPORTUNISTIC_OVERHEARING.md),
[Asset receive path](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/src/atlas_meshtastic_link/asset/runner.py#L127),
and [gateway broadcasts](https://github.com/the-Drunken-coder/atlas-meshtastic-link-pypi-retired/blob/b8de3a5a61a220e13a4097aabe526e55d2749013/package/src/atlas_meshtastic_link/gateway/operations/runtime.py#L279)
are design references, not current contracts. Its listening path was wired, but
its documented version ordering and cache expiry were incomplete. Its domain
records, provisioning exchange, and reliability guarantees are not adopted here.

