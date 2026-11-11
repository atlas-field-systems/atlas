# Atlas Gateway

A gateway carries Atlas across field links. It runs on its own computer, uplinks
to the [Core API](../core/docs/api.md) over broadband IP, and runs the Fieldlinks
its radios need. A gateway is not an Asset.

**Planning.** Nothing is built. This page records how radio Assets join Atlas
through a gateway and what every Fieldlink must provide. The rest of the gateway
design is deferred.

## The gateway app and its Fieldlinks

- **The gateway app** is the software every gateway runs. It calls the Core
  API with the [SDK](../sdk/README.md) on behalf of the Assets it carries.
- **A Fieldlink** is a package installed on the gateway app. It carries Atlas over
  one kind of field link, such as Meshtastic LoRa. A gateway installs the
  Fieldlinks its radios need, and the radio Asset runs the same package.
- Fieldlinks live in this folder beside the gateway app, so the two are tested
  together.

## One gateway per site

A site runs one gateway at a time ([Scale](../atlas/scale.md#setup)). Each radio
Asset is carried by that gateway: the gateway hears it, makes its Core API calls,
and reports its contact. Core shows which gateway carries each Asset.

Core authenticates the gateway with its key and trusts it for which radio Asset
sent what. A radio Asset holds no Core key and never calls the Core API. A
gateway can add radio Assets, but it cannot add an Asset on IP or issue a Core
key.

## What every Fieldlink provides

Each Fieldlink decides how it meets these rules on its link. The rules are the
same for all of them.

- **Each radio has its own identity**, made with the field link's own
  cryptography, such as a Meshtastic node's public key or a Reticulum identity.
  This **radio identity** names one radio. It is public, not a secret, so Core
  may store and show it.
- **Only that radio can speak as its Asset.** The gateway accepts a frame for
  `asset_id` X only when it comes from X's radio identity, and it rejects
  replayed frames. A shared channel key alone is not enough: another radio, or
  anyone holding a leaked channel key, must not be able to pretend to be X.
- **Joining the field link is the Fieldlink's own step**, such as receiving a
  private channel's key. A radio that has joined can appear as a new Asset, but
  it can never speak as an Asset that is already some other radio.
- **The definitions hash is checked each time a radio's link opens.** The
  Fieldlink compares the radio's hash with the gateway's, as each link
  [checks its hash when it opens](../atlas/api-proposal.md#fieldlinks).

Each Fieldlink's own docs say how it meets these rules, once written.

## How a radio Asset joins and leaves

These are the results operators and admins see. The calls behind them are in the
[Core API](../core/docs/api.md#radio-assets).

- **A new radio appears on its own.** When the gateway hears a radio no admin
  has set up, Core adds it as a new Asset and picks its `asset_id`. There is no
  approval step. The event log records that the gateway added it.
- **An admin can set up a radio in advance.** The admin chooses its `asset_id`
  and names its radio identity. That radio appears with that ID the first time
  it is heard.
- **A radio keeps its ID.** The same radio comes back with the same `asset_id`
  every run until an admin removes it. Its Tasks and settings still start fresh
  each run, as for every Asset.
- **A removed radio stays out.** When an admin removes a radio Asset, Core
  refuses that radio if it is heard again, and does not add it as a new Asset.
  Operators see the refusal. An admin brings the radio back by setting it up
  again in advance.
- **A radio with different definitions is refused.** Operators see "radio X was
  refused: different definitions", as they would for an Asset on IP. A radio
  never seen before is not added as an Asset; it shows only in that refusal.

## When the gateway changes

- **Its key is replaced.** The radios are unaffected. The gateway reconnects with
  its new key.
- **It is removed.** Its radios stay in Atlas with their IDs and show offline.
  They are carried by no gateway until a gateway hears them.
- **A new gateway is added.** Each radio moves to it as soon as the new gateway
  hears it, keeping its ID, with no admin step for each radio.

## Gateway contact

Core shows each gateway online or offline by the same `offline_after_s` rule it
uses for Assets. When the gateway goes offline, every radio Asset it carries
shows offline too. An operator can therefore tell a gateway that is down (the
gateway and all its radios offline) from radios that went quiet (the gateway
online, some radios offline). [Contact](../core/docs/api.md#contact) has the
rule.

## Scenarios

Behavior tests come from these, once the gateway exists.

- Switch on a radio on the private link that no admin set up. It appears as a new
  Asset with a Core-picked ID, added by the gateway.
- Set up `D1` in advance for one radio, then switch it on. It appears as `D1`.
- Restart Core's run and the radio. The radio comes back with the same ID.
- Send a frame for an Asset from a different radio identity, then replay one of
  its earlier frames. The gateway rejects both, and Core stores neither.
- Remove a radio Asset and switch the radio on again. Core refuses it, operators
  see the refusal, and no new Asset appears. Set it up again; it returns.
- Switch on a never-seen radio with different definitions. Operators see the
  refusal, and no Asset is added.
- Replace the gateway's key. Every radio stays online once the gateway reconnects.
- Stop the gateway. The gateway and every radio it carries show offline after
  `offline_after_s`.
- Remove the gateway and add a new one. Each radio keeps its ID and moves to the
  new gateway when it is heard.

## Where the selected rules live

- [Asset and gateway calls](../core/docs/api.md#asset-and-gateway-calls) and
  [radio Assets](../core/docs/api.md#radio-assets): what a gateway does at the
  Core API.
- [Fieldlinks](../atlas/api-proposal.md#fieldlinks): the sketch of the LoRa
  Fieldlink.
- [Operating environment](../atlas/environment.md): the field links, and how
  gateway designs change over time.
- [The Asset link](../sdk/docs/asset.md#the-asset-link): the interface a
  Fieldlink gives the Asset app. A Fieldlink may deliver Tasks one at a time and
  in any order. The Asset app orders them by `task_id` and starts a request's
  Tasks only when it has received them all.

## Not designed yet

- The gateway app: its parts, its configuration, its logging, and its Reset ZIP.
- How a Fieldlink is installed, started, and tested with the gateway app.
- Each Fieldlink's docs, including how it meets the rules above.
- What each field link can carry. [About 20 Assets](../atlas/scale.md#fleet) is a
  goal, and a Fieldlink states what its link supports.

AI agents: read [AGENTS.md](AGENTS.md).
