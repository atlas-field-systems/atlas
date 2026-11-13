# Atlas Gateway

A gateway carries Atlas across a field link. It runs on its own computer,
uplinks to the [Core API](../core/docs/api.md) over broadband IP, and talks to
Assets over a radio through one installed [Fieldlink](../fieldlink/README.md). A
gateway is not an Asset.

**Planning.** Nothing is built. This page owns the gateway app: the framework
every gateway runs, how it installs and runs a Fieldlink, and the gateway
interface it gives that Fieldlink.

## The gateway app is a framework

The gateway app does the work every gateway shares, whatever its radio:

- It connects to Core with the gateway's key, through the [SDK](../sdk/README.md).
- It [registers](../core/docs/api.md#radio-assets) each Asset its Fieldlink
  hears and makes that Asset's Core API calls.
- It reports each Asset's [contact](#gateway-contact).
- It checks its configuration, and writes its diagnostics and its
  [Reset ZIP](#the-gateways-reset-zip).

Everything about the radio belongs to the Fieldlink.

## Installing and running Fieldlinks

- **Installing and updating takes one action.** The gateway app has a text
  screen (TUI) on the gateway's console. It lists every published Fieldlink,
  marks which are installed and which have an update, and installs or updates
  one with a single keypress. The same actions are plain commands (CLI) for
  scripts. With internet, the gateway fetches the package from the Atlas
  releases and checks it against its published checksum. Without internet, the
  admin picks a package file, such as one on a USB stick, from the same screen.
  The gateway app refuses a Fieldlink that does not work with its
  [gateway interface](#the-gateway-interface) version, and says which version it
  needs. An install or update takes effect when the gateway next starts,
  between runs.
- **One Fieldlink at a time.** The admin picks one installed Fieldlink in the
  gateway's configuration. At start the gateway app checks that the Fieldlink
  is installed and fits its version, and that its radio hardware is present; if
  not, it does not start and prints why. Changing Fieldlinks means changing the
  configuration and restarting the gateway between runs.

## The gateway interface

The gateway app gives its Fieldlink a small, stable interface, built on the SDK.
A Fieldlink uses only this interface and never calls the SDK directly, so an SDK
update changes the gateway app, not every Fieldlink. The interface changes only
with a new gateway app version, and each Fieldlink states which versions it
works with.

- **A radio was heard.** The Fieldlink reports a new radio; the gateway app
  registers it and answers with its `asset_id`.
- **Per Asset**, the gateway app supplies its requests in event order, sends its
  reports, takes its contact, and stores its files: the
  [Asset link](../sdk/docs/asset.md#the-asset-link), on the gateway's own Core
  connection. A gateway-and-Asset Fieldlink carries it over the radio to the
  Asset app on the Asset.
- **Run an Asset app here.** For a
  [gateway-only Fieldlink](../fieldlink/README.md#two-kinds-of-fieldlink), the
  gateway app runs the standard Asset app for the vehicle, with that Asset
  link, and the Fieldlink hands the radio connection to the app's equipment
  driver.

The gateway app logs both sides of the interface. The exact TypeScript
interface is written with the first Fieldlink.

## One gateway per site

A site runs one gateway at a time. Each radio Asset is carried by that gateway:
the gateway hears it, makes its Core API calls, and reports its contact. Core
shows which gateway carries each Asset. Core authenticates the gateway with its
key and trusts it for which radio Asset sent what. A gateway can register radio
Assets, but it cannot register an Asset on IP or issue a Core key. On a mesh
Fieldlink such as [Meshtastic](../fieldlink/meshtastic/README.md), Assets talk to each other and to the one gateway,
and many Assets ride on it; a SiK gateway carries one vehicle. Several gateways
in one network are out of scope.

How radio Assets register, keep their IDs, and what happens when the gateway
changes is in
[Runs and identity](../atlas/runs-and-identity.md#radio-assets). The calls
behind it are in the [Core API](../core/docs/api.md#radio-assets).

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
- Open the gateway's screen with internet, and press install on SiK. It is
  installed with no other step.
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
- [Fieldlink](../fieldlink/README.md): what every Fieldlink is and provides,
  and the first two, SiK and Meshtastic.

## Not designed yet

- The gateway app's configuration file and what its diagnostics record.
- What each field link can carry. [About 20 Assets](../atlas/scale.md#fleet) is a
  goal, and a Fieldlink states what its link supports.

AI agents: read [AGENTS.md](AGENTS.md).
