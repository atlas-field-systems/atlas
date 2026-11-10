# Atlas Gateway

A gateway carries Atlas across field links. It runs on its own computer, uplinks
to the [Core API](../core/docs/api.md) over broadband IP, and runs the Fieldlinks
its radios need. A gateway is not an Asset.

**Planning.** Nothing is built, and the detailed design is deferred. This page
records the owner's intended shape.

## The gateway app and its Fieldlinks

- **The gateway app** is the software every gateway runs. It calls the Core
  API with the [SDK](../sdk/README.md) on behalf of the Assets it carries.
- **A Fieldlink** is a package installed on the gateway app. It carries Atlas over
  one kind of field link, such as Meshtastic LoRa. A gateway installs the
  Fieldlinks its radios need, and the radio Asset runs the same package.
- Fieldlinks live in this folder beside the gateway app, so the two are tested
  together.

## Where the selected rules live

- [Asset and gateway calls](../core/docs/api.md#asset-and-gateway-calls): what a
  gateway does at the Core API, and what Core trusts it for.
- [Fieldlinks](../atlas/api-proposal.md#fieldlinks): the sketch of the LoRa
  Fieldlink and what every Fieldlink owns.
- [Operating environment](../atlas/environment.md): the field links, and why
  different gateways can coexist.
- [The Asset link](../sdk/docs/asset.md#the-asset-link): the interface a
  Fieldlink gives the Asset app. A Fieldlink may deliver Tasks one at a time and
  in any order. The Asset app orders them by `task_id` and starts a request's
  Tasks only when it holds them all.

## Not designed yet

- The gateway app: its parts, its configuration, its logging, and its Reset ZIP.
- How a Fieldlink is installed, started, and tested with the gateway app.
- How an Asset authenticates to its gateway. Each Fieldlink decides for its
  radio, and the owner plans a separate pass on it.
- How a gateway is bound to the Assets it carries, and how it reports their
  contact ([Core API](../core/docs/api.md#not-defined-yet)).
- What each field link can carry. [About 20 Assets](../atlas/scale.md#fleet) is a
  goal, and a Fieldlink states what its link supports.

AI agents: read [AGENTS.md](AGENTS.md).
