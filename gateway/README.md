# Atlas Gateway

A gateway carries Atlas across a field link. It runs on its own computer,
uplinks to the [Core API](../core/docs/api.md) over broadband IP, and talks to
Assets over a radio. A gateway is not an Asset.

**Planning.** Nothing is built. This page owns the gateway app: the framework
every gateway runs, how it runs one operating mode, and what every mode
provides. Each mode has its own page under [fieldlinks/](fieldlinks/).

## The gateway app is a framework

The gateway app does the work every gateway shares, whatever its radio:

- It connects to Core with the gateway's key, through the [SDK](../sdk/README.md).
- It [registers](../core/docs/api.md#radio-assets) each Asset its radio hears
  and makes that Asset's Core API calls.
- It reports each Asset's [contact](#gateway-contact).
- It checks its configuration, and writes its diagnostics and its
  [Reset ZIP](#the-gateways-reset-zip).

Everything about the radio itself belongs to a Fieldlink.

## Fieldlinks are the gateway's operating modes

A Fieldlink is one operating mode of the gateway. It is defined by two things:
the radio hardware plugged into the gateway, and the software that runs over
it. It owns everything about that radio: driving the hardware, its encoding,
retries, duplicates, contact timing, and link security.

| Fieldlink | Radio hardware | Radio software | Assets | Page |
| --- | --- | --- | --- | --- |
| SiK | A SiK telemetry radio pair | MAVLink | One vehicle | [SiK](fieldlinks/sik/README.md) |
| Meshtastic | LoRa radios | Meshtastic firmware | Many, in a mesh | [Meshtastic](fieldlinks/meshtastic/README.md) |

FLRC and other radios get their own Fieldlinks later. A mesh that mixes radio
types is one Fieldlink covering both.

- **Each Fieldlink is its own package.** It has its own version and is
  released on its own, so updating a Fieldlink never needs a new gateway app.
  It states which gateway app versions it works with.
- **The admin installs Fieldlinks on the gateway.** The gateway app's install
  command takes a Fieldlink package file, so it works in the field with no
  internet. The gateway app lists, updates, and removes installed Fieldlinks.
  It refuses a Fieldlink that does not work with its version, and says why. An
  install or update takes effect when the gateway next starts, between runs.
- **One mode at a time.** The admin picks one installed Fieldlink in the
  gateway's configuration. At start the gateway app checks that the Fieldlink
  is installed and fits its version, and that its radio hardware is present; if
  not, it does not start and prints why. Changing modes means changing the
  configuration and restarting the gateway between runs.

A Fieldlink works in one of two ways:

- **It carries Atlas to the Asset.** The Asset runs the [Asset app](../asset/README.md)
  with the same Fieldlink package installed the same way, and Atlas records cross the radio in the
  Fieldlink's compact encoding. Meshtastic works this way.
- **It runs the Asset app on the gateway.** The vehicle speaks only its own
  protocol, such as MAVLink, and runs no Atlas software. The Fieldlink runs the
  Asset app for that vehicle on the gateway, and the app's equipment driver
  talks to the vehicle over the radio. SiK works this way.

Either way the operator sees the same Asset. An Asset with its own IP link
needs no gateway: it [calls the Core API itself](../core/docs/api.md#asset-and-gateway-calls).

### The Fieldlink interface

The gateway app starts its one Fieldlink and hands it a small interface. The
Fieldlink tells the app when it hears a new radio, and the app registers it and
answers with its `asset_id`. For each Asset, the Fieldlink then supplies an
[Asset link](../sdk/docs/asset.md#the-asset-link): a Fieldlink that carries
Atlas builds it over the radio, and one that runs the Asset app on the gateway
builds it on the gateway's own Core connection. The gateway app logs both
sides. Because Fieldlinks are released apart from the gateway app, this
interface is the contract between them: it changes only with a new gateway app
version. The exact TypeScript interface is written with the first Fieldlink.

## Folder layout

| Path | Holds |
| --- | --- |
| `gateway/README.md` | This page: the gateway app |
| `gateway/fieldlinks/<name>/` | One Fieldlink package: its page now, its code later, with its own version |

The gateway app's code will sit beside `fieldlinks/` when it is written. Each
Fieldlink is released from `prod` as its own package, like Protocol; publishing
is set up when the first one has code.

## One gateway per site

A site runs one gateway at a time. Each radio Asset is carried by that gateway:
the gateway hears it, makes its Core API calls, and reports its contact. Core
shows which gateway carries each Asset. Core authenticates the gateway with its
key and trusts it for which radio Asset sent what. A gateway can register radio
Assets, but it cannot register an Asset on IP or issue a Core key. On a mesh
Fieldlink such as Meshtastic, Assets talk to each other and to the one gateway,
and many Assets ride on it; a SiK gateway carries one vehicle. Several gateways
in one network are out of scope.

How radio Assets register, keep their IDs, and what happens when the gateway
changes is in
[Runs and identity](../atlas/runs-and-identity.md#radio-assets). The calls
behind it are in the [Core API](../core/docs/api.md#radio-assets).

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
  Fieldlink that carries Atlas compares the radio's hash with the gateway's.
  One that runs the Asset app on the gateway uses the gateway's own definitions,
  so there is nothing to compare. A radio with
  different definitions is refused and not added as an Asset; operators see
  "a radio on gateway G1 was refused: different definitions", as they would
  for an Asset on IP.

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
in it. If the ZIP fails, it keeps them, removes the incomplete file, and records
and prints the failure so the admin sees it; it does not try again at a later
start. It never deletes a ZIP. When logging
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
- Configure a Fieldlink whose radio is not plugged in. The gateway does not
  start and prints which radio it is missing.
- Install a newer version of the gateway's Fieldlink from a file, with no
  internet, and restart the gateway between runs. It runs the new version with
  the same gateway app.
- Install a Fieldlink that does not work with this gateway app's version. The
  gateway app refuses it and says which versions it needs.
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
- [SiK](fieldlinks/sik/README.md) and [Meshtastic](fieldlinks/meshtastic/README.md):
  the first two Fieldlinks.

## Not designed yet

- The gateway app's configuration file and what its diagnostics record.
- What each field link can carry. [About 20 Assets](../atlas/scale.md#fleet) is a
  goal, and a Fieldlink states what its link supports.

AI agents: read [AGENTS.md](AGENTS.md).
