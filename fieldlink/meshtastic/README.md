# Meshtastic Fieldlink

The Meshtastic Fieldlink is sketched to carry Atlas over LoRa radios running
Meshtastic, to many Assets in a mesh, with a gateway side and an Asset side.
[What every Fieldlink is](../README.md) and the [gateway app](../../gateway/README.md)
are on their own pages. This folder is the home for all Meshtastic-specific
documentation: radio behavior, integration proposals, bench measurements, and
historical references. Other parts link here. Listening and local-picture ideas
are in the [drawer](../../docs/drawer/meshtastic-listening.md).
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

As [every Fieldlink](../README.md#both-sides-run-atlas) does,
each Asset runs the Asset app with this Fieldlink's Asset side. On top of Meshtastic, the
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
  Fieldlink passes it through the gateway to Core so Core refuses a mismatch
  and records it.

## Proposal: binary encoding

**A proposal, not a decision.** It answers the compact-encoding question in
[Open engineering questions](#open-engineering-questions) with one approach:
carry Atlas records over the radio as binary, not JSON. This leaves more
airtime after the [operator deadlines](../../atlas/scale.md#operator-deadlines-come-first) are met.
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
  [changes with full-record recovery](../../docs/drawer/meshtastic-listening.md#listening-and-shared-updates). The
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
differ slightly from the value that was sent. It uses the
[precision every Fieldlink may round to](../README.md#what-every-fieldlink-provides). That is
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
[decided bench work](../../atlas/archive/decision-log.md#build-and-test), not completed evidence.

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
