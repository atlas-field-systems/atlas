# Atlas Gateway

A gateway carries Atlas across field links. It runs on its own computer, uplinks
to the [Core API](../core/docs/api.md) over broadband IP, and runs the Fieldlinks
its radios need. A gateway is not an Asset.

**Planning.** Nothing is built. This page records what every Fieldlink must
provide, the LoRa Fieldlink sketch, gateway contact, and the gateway's Reset
ZIP. The rest of the gateway design is deferred.

## The gateway app and its Fieldlinks

- **The gateway app** is the software every gateway runs. It calls the Core
  API with the [SDK](../sdk/README.md) on behalf of the Assets it carries.
- **A Fieldlink** is a package installed on the gateway app. It carries Atlas over
  one kind of field link, such as Meshtastic LoRa. A gateway installs the
  Fieldlinks its radios need, and the radio Asset runs the same package.
- Fieldlinks live in this folder beside the gateway app, so the two are tested
  together.

## One gateway per site

A site runs one gateway at a time. Each radio Asset is carried by that gateway:
the gateway hears it, makes its Core API calls, and reports its contact. Core
shows which gateway carries each Asset. Core authenticates the gateway with its
key and trusts it for which radio Asset sent what. A gateway can register radio
Assets, but it cannot register an Asset on IP or issue a Core key. The radio
network is a mesh: Assets talk to each other and to the one gateway, and many
Assets ride on it. Several gateways in one network are out of scope.

How radio Assets register, keep their IDs, and what happens when the gateway
changes is in
[Runs and identity](../atlas/runs-and-identity.md#radio-assets). The calls
behind it are in the [Core API](../core/docs/api.md#radio-assets).

## What every Fieldlink provides

Each Fieldlink decides how it meets these rules on its link. The rules are the
same for all of them.

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
- **The definitions hash is checked each time a radio's link opens.** The
  Fieldlink compares the radio's hash with the gateway's. A radio with
  different definitions is refused and not added as an Asset; operators see
  "a radio on gateway G1 was refused: different definitions", as they would
  for an Asset on IP.

Each Fieldlink's own docs say how it meets these rules, once written.

## The LoRa Fieldlink (sketch)

For the LoRa phase, the Fieldlink builds on Meshtastic: a private channel, a
private app port, and Meshtastic's encryption, routing, and per-hop
acknowledgements. The Fieldlink adds end-to-end acknowledgement of Tasks and
final reports, idempotency by `task_id`, and per-Asset contact reports to Core.
Protocol defines no short keys, so each Fieldlink chooses its own compact
encoding. The gateway's link to Core is broadband IP, so the gateway keeps its
Assets' full state and sends over the radio only what each Asset does not
already have. FLRC follows with its own Fieldlink.

## Gateway contact

Core shows each gateway online or offline by the same `offline_after_s` rule it
uses for Assets. When the gateway goes offline, every radio Asset it carries
shows offline too. An operator can therefore tell a gateway that is down (the
gateway and all its radios offline) from radios that went quiet (the gateway
online, some radios offline). [Contact](../core/docs/api.md#contact) has the
rule.

## The gateway's Reset ZIP

The gateway app stays running across Core's runs, and keeps its own record for
each one. Like every part, it records detailed diagnostics for its app and its
Fieldlinks, never records a credential, and never sends logs over a field link.

- **When Core's run ends**, the gateway writes a ZIP for that run. It knows the
  run ended when it reaches Core again and `GET /about` shows a new `run_id`
  ([Core API basics](../core/docs/api.md#basics)). Its time cut off from Core
  belongs to the run that ended.
- **When the gateway shuts down**, it writes a ZIP for everything since its last
  one. After a crash or power loss, its next start writes that ZIP first,
  marked "the gateway stopped unexpectedly; this record may be incomplete".

Each ZIP goes into the gateway's archive folder, named
`gateway-<gateway_id>-<start>.zip`, where `<start>` is the start of the time it
covers in UTC as `YYYYMMDDTHHMMSSZ`. A person copies it off the gateway's
computer by hand.

| File | Holds |
| --- | --- |
| `README.md` | What each file is |
| `summary.md` | The time covered, the Core `run_id`, contact with Core, each radio heard and when, and every gap |
| `manifest.json` | Every file with its size and SHA-256, whether the gateway stopped normally, and every known gap |
| `diagnostics/` | The gateway app's and each Fieldlink's diagnostics, as written |
| `config.json` | The configuration, with secrets removed |
| `versions.json` | The gateway app, each Fieldlink, and the Protocol package versions, and the definitions hash |

The gateway checks each ZIP against its manifest before it deletes the records
in it, and keeps them if the ZIP fails. It never deletes a ZIP. When logging
cannot keep up or the disk fills, it carries frames before it writes logs: it
drops records rather than holding up a radio, counts them, and lists the gap in
the ZIP, as the [Asset does](../asset/docs/logging.md#when-logging-cannot-keep-up).

## Scenarios

Behavior tests come from these, once the gateway exists.

- Switch on a radio on the private link. It appears as a new Asset with a
  Core-picked ID, registered by the gateway, and the radio learns its ID.
- Lose and regain the radio's link during the run. It keeps its ID.
- Start a new run and switch the radio on again. It comes back as a new Asset
  with a new ID.
- Send a frame for an Asset from a different radio identity, then replay one of
  its earlier frames. The gateway rejects both, and Core stores neither.
- Remove a radio Asset and switch the radio on again. It comes back as a new
  Asset with a new ID.
- Switch on a radio with different definitions. Operators see the refusal, and
  no Asset is added.
- Replace the gateway's key. Every radio stays online once the gateway reconnects.
- Stop the gateway. The gateway and every radio it carries show offline after
  `offline_after_s`.
- Remove the gateway and add a new one during the run. Each radio the new
  gateway hears registers as a new Asset with a new ID; the old Assets stay
  offline.
- Remove the gateway and add none. Its radios stay in the picture, offline,
  with their IDs.
- Kill Core and start it again while the gateway runs. `GET /about` shows the
  same `run_id`, the gateway writes no ZIP, and every radio keeps its ID.
- Stop Core and start it again while the gateway runs. The gateway writes one
  ZIP for the run that ended, and each radio it hears in the new run registers
  as a new Asset.

## Related pages

- [Runs and identity](../atlas/runs-and-identity.md): how radio Assets
  register, keep their IDs, and what happens when the gateway changes.
- [Asset and gateway calls](../core/docs/api.md#asset-and-gateway-calls) and
  [radio Assets](../core/docs/api.md#radio-assets): what a gateway does at the
  Core API.
- [Operating environment](../atlas/environment.md): the field links, and how
  gateway designs change over time.
- [The Asset link](../sdk/docs/asset.md#the-asset-link): the interface a
  Fieldlink gives the Asset app.

## Not designed yet

- The gateway app: its parts, its configuration, and what its diagnostics record.
- How a Fieldlink is installed, started, and tested with the gateway app.
- Each Fieldlink's docs, including how it meets the rules above.
- What each field link can carry. [About 20 Assets](../atlas/scale.md#fleet) is a
  goal, and a Fieldlink states what its link supports.

AI agents: read [AGENTS.md](AGENTS.md).
