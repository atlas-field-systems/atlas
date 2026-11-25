# Meshtastic Fieldlink

The Meshtastic Fieldlink carries Atlas over LoRa radios running
Meshtastic, to many Assets in a mesh, with a gateway side and an Asset side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages. This folder is the home for all Meshtastic-specific
documentation: radio behavior, listening and the local picture, integration
proposals, bench measurements, and historical references. Other parts link here.
Documentation location does not change which component owns runtime behavior.

## First implementation

The first slice runs one gateway and three Assets through one relay on ShortTurbo.
The gateway polls each radio for reports and delivers Core Tasks in those same
turns. Waiting Tasks and must-arrive reports go before routine check-ins when
contact deadlines allow. Retries and routine check-ins share one schedule
that reserves time to renew contact before it expires. On a clean link,
healthy Assets receive authenticated polls no more than 10 seconds apart.
An Asset can go about 14 seconds without hearing the gateway after one lost
message. The Asset requires `link_loss_after_s` to be at least 15 seconds
at startup and refuses shorter values in settings requests and Tasks. A join waits if
measured turns leave too little room for established Assets to check in.
The gateway reports a radio offline 14,900 ms after its last reply, even if
the radio's replacement app fails to register. Meshtastic reports each
transition through [the gateway host's contact queue](../../gateway/README.md#gateway-contact).
On a link that
loses 5% of messages at random, a healthy Asset briefly shows offline about
once an hour; its next check-in restores it. The gateway backs off unanswered
offline probes up to 30 seconds between attempts. A discovery announcement
makes the radio eligible for an immediate probe. The Asset counts authenticated
polls as contact with its gateway, including while it waits for its first report receipts.
Running Assets promptly announce when they hear their gateway restart, and the
gateway prioritizes a poll on resume. After restart, it counts each carried
Asset's 14,900 ms deadline from the last-heard time in Core's roster. If Core has
no last-heard time, it counts from gateway startup. A healthy Asset may briefly
show offline until it rejoins. The channel key alone protects a beacon, and a beacon can only prompt an announce.
After prolonged silence a radio announces again. The same running Asset app
rejoins after a gateway restart or a radio bridge failure. Its Tasks
and pending reports carry over within the same Core run. If the Asset radio
bridge fails, the running app sees contact lost.

The link uses dictionary-compressed JSON in frames up to 180 bytes. A poll
offers one frame of reply room and carries the receipt for the previous
submission after Core stores it. Retries keep the same submission ID. The
Asset chooses the reports through its SDK report source. A reply can span up to
two frames. If a batch exceeds that limit, the Asset refuses it once and the
outbox records the refusal. Core storage runs between radio turns. A later poll
carries the receipt, and duplicates of a pending submission share its write.
If the poll carried an event or a reply indicated more reports were waiting,
the gateway schedules a follow-up once storage finishes.
The reply window begins after the gateway submits the final poll frame. The
2,300 ms default fits two reply frames in the relayed ShortTurbo simulator. A poll
carrying an event allows another 150 ms for the Asset to queue its report,
covering the example configs' 100 ms control tick plus 50 ms of margin. The
reply can carry the Task's active report in the delivery exchange. Re-measure the window
on physical radios.
Tasks typically start within 10 seconds, and within 15 seconds while another
Asset is dropping out. The gateway detects silence within 15 seconds.

Provision each radio with ShortTurbo and a private 32-byte channel key for
discovery. The gateway and each Asset radio must have the other's public key
in their Meshtastic node databases. Put them on the same mesh and exchange
Meshtastic NodeInfo in both directions before starting Atlas. With the Python
client, use `sendData` to send each radio's own NodeInfo user record to the
other node on `NODEINFO_APP`. Verify the peer's `user.publicKey` in each
radio's `nodesByNum` before starting the gateway and Asset apps.
Atlas transmissions use one relay hop. The radio bridge uses
`meshtastic==2.7.11`. See the [gateway guide](../../gateway/README.md) and the
[Asset link options](../../asset/config.md#options).

## Hardware and software

- **Radio hardware.** A LoRa radio running Meshtastic, plugged into the gateway
  computer, and one on each Asset, plugged into the computer that runs its
  Asset app.
- **Radio software.** Meshtastic firmware: a private channel, a private app
  port, and Meshtastic's encryption and routing. Atlas confirms delivery in a later poll.

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
- **Joining.** A discovery announcement on the provisioned channel starts registration.
- **Definitions hash.** Each radio sends its hash when its link opens, and the
  gateway compares it with its own.

## Potential concepts

These ideas from earlier Meshtastic work are options we could use. None is
selected for implementation or a decision that must be settled before a build.
They can be considered separately.

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
- **Authenticated sources.** A listener needs the sender's radio identity, as
  the gateway gets it, and replay rejection. Authentication and encryption
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

## Proposal: binary encoding

**A proposal, not a decision.** It answers the compact-encoding question in
[Open engineering questions](#open-engineering-questions) with one approach:
carry Atlas records over the radio as binary, not JSON. This helps Atlas
[use slow links fully and efficiently](../../atlas/scale.md#use-slow-links-fully-and-efficiently).
The encoding does not depend on Meshtastic, so a later Fieldlink can reuse it.

### Why binary works here

Both ends load the same definitions, and the
[definitions hash](../README.md#what-every-fieldlink-provides) is checked when
each link opens. Since both ends hold the same schema, a field's position in the
frame can say what it is, so no field names travel. On top of that:

- **No `asset_id` on the radio** when the frame goes between the gateway and
  that Asset's own radio. The gateway fills the ID in from the radio identity,
  and the Asset already knows its own ID. A record about
  another Asset carries its ID.
- **Short times.** Each frame carries one base time. Each report in it carries
  a 2-byte offset from that time; a report too far from the base time for the
  offset goes in another frame.
- **IDs as indexes.** IDs both ends already know, such as a subsystem from the
  Asset's description or the operator in `requested_by`, become a 1-byte index.
- **Enumerations as small numbers.** Values such as `degraded`, `launch` or
  `airplane` become an index into the list in the definition.
- **Numbers as fixed-size integers.** For example, latitude and longitude as
  4-byte integers in units of 10⁻⁷ degrees (about 1 cm). Meshtastic uses the
  same units for its own positions. A value the integer cannot hold, such as an
  altitude above about 3 km in a 2-byte field, is carried exactly instead.
- **Text stays text**, with its length in front.

### Rough sizes

These are hand counts of this layout applied to Protocol's own examples, not
measurements of a built encoder. "Deflate" is compressed JSON with a shared
dictionary of field names and common values.

| Record | JSON | Deflate | Binary |
| --- | --- | --- | --- |
| Telemetry: position, two altitudes, speed, heading | 267 B | 103 B | 20 B |
| Battery | 83 B | 40 B | 4 B |
| Task status | 109 B | 54 B | 6 B |
| `move_to` Task | 220 B | 96 B | 19 B |
| `coordinates` Observation with ADS-B details | 382 B | 135 B | 35 B |
| `bearing` Observation | 347 B | 121 B | 28 B |
| Subsystem degraded, with explanation | 179 B | 63 B | 44 B |
| Failsafe response, with explanation | 203 B | 74 B | 37 B |
| **Total** | **1790 B** | **686 B** | **193 B** |

Binary is about 9 times smaller than JSON overall. Records made only of numbers
and short values shrink 11 to 21 times. Records with free text shrink only 4 to
6 times, because the text itself is the floor.

### Where the airtime goes

Every packet has a fixed cost before it carries any Atlas data: the preamble,
Meshtastic's 16-byte header, and its data wrapper. On the default LongFast
preset (SF11, 250 kHz, coding rate 4/5), that is about 400 ms. 20 bytes of Atlas
data add about 160 ms, and a full 233-byte payload takes about 2.1 s. These
figures are for the shared channel. Sending each frame as a Meshtastic direct
message, which proves which radio sent it, adds about 12 bytes, or about 80 ms,
and leaves about 12 bytes less room for Atlas data.

A routine update (telemetry, battery, and Task status) is 475 bytes as a JSON
`reports` batch. That is more than two packets hold, so it needs three packets
and about 4.7 s of airtime. As binary it is 34 bytes, base time included, in one
packet, about 640 ms. At that size the fixed cost is about 60% of the packet's
airtime, and each byte saved is on average only about 1% of it. So, after binary,
the larger savings are:

- **Fill each packet.** Several reports in one packet spread the fixed cost.
- **Send only what changed**, as in
  [changes with full-record recovery](#listening-and-shared-updates). The
  receiver still rebuilds each complete record, and
  [Protocol allows it](../../protocol/docs/decisions.md#the-shared-picture).
- **Mind relays.** Each relay hop sends the whole packet again, so every byte
  saved is saved once per hop.

### Keeping it simple

- **One generic codec built from the definitions**, not a hand-written layout
  for each record. A new record or field gets an encoding without new
  Fieldlink code.
- **Byte-aligned fields and variable-length integers.** No bit-level packing or
  custom compressor, because each byte they save is on average about 1% of a
  packet's airtime.
- **A precision table in this Fieldlink.** It says how finely each kind of number
  is kept: latitude and longitude, altitude, angles, speeds. A number the table
  does not cover is carried exactly.

### Rounding

Binary rounds numbers to the precision in the table, so a value that arrives may
differ slightly from the value that was sent. The owner accepted rounding to
about 1 cm for positions, 10 cm for altitudes, 0.01° for angles, and 1 cm/s for
speeds ([decision log](../../atlas/decision-log.md#runs-and-identity)). That is
finer than the GPS and sensors that produce these values. Rounding never makes a
value Protocol forbids, such as a heading of 360°; such a value is carried exactly.

### Still to check

The sizes above leave out acknowledgements and relay hops, and the airtime
figures assume the shared channel unless they say otherwise. The
[radio measurement](#radio-measurement) replaces these estimates with measured
airtime.

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

- The compact encoding, frame size, retry timing, and contact timing. One
  approach for the encoding is the [binary encoding proposal](#proposal-binary-encoding).
- How the Fieldlink works out how much room it has before it
  [asks the Asset for reports](../../asset/docs/communications.md#report-from-local-state).
  Meshtastic firmware reports how full its send queue is and how busy the
  channel is, and a packet's airtime follows from the radio settings. Which of
  these it uses waits for the bench measurement.
- How much the link carries in practice, measured with two radios on the bench
  ([radio measurement](#radio-measurement)).

AI agents: read [the Fieldlink AGENTS.md](../AGENTS.md).
