# Operating environment

Atlas connects operators to physical and digital Assets. Its normal field path
crosses a gateway and a radio link.

## Connectivity evolves

Radio technology, IP connectivity, and edge networks will keep changing.
Atlas is designed around constrained links with different capabilities.
A LoRa-scale data rate is not a ceiling for the whole system.

The field radio starts as pure LoRa. The next step is a multi-layer
mesh: 2.4 GHz FLRC between Assets wherever FLRC is viable, and 915 MHz LoRa
where it is not. Wi-Fi is a possible addition. FLRC is expected to carry more
than single-digit kilobits per second. Initial Assets use a single link, so
multiple-link routing is not a prerequisite for them. The radio project owns the
detailed design as the hardware evolves.

Field links carry Atlas through Fieldlinks. The same Fieldlink package runs on
the gateway and on the radio Asset, and it sends compact frames in a proven
existing encoding, not a custom one. The LoRa phase builds on Meshtastic, and
FLRC gets its own Fieldlink. The [API proposal](api-proposal.md#fieldlinks)
sketches the LoRa Fieldlink. Each Fieldlink's docs own its mechanisms, once
written.

## IP mainly connects the supporting systems

IP primarily connects Core, gateways, and the Command Interface, through the
[Core API](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md).
Most physical Assets use the available field radios beyond the gateway.
Direct-IP Assets are possible, especially purely digital Assets.

Field links can disappear and return. Atlas cannot assume continuous IP
connectivity to every Asset.

## Gateway implementations can coexist

Different radio systems can have different gateways. For example, the initial
LoRa link could have a dedicated LoRa gateway. A later FLRC mesh could have a new
gateway while the older gateway is still maintained. Gateways can coexist
because each reaches Core only through the Core API. Atlas does not assume one
permanent gateway design, and gateway design is otherwise deferred.

## Core is a deliberate dependency

Atlas communications depend on Core to keep the system simpler.
Offline authorization of new work is not a current requirement.
Core dependence does not imply that Core or every field link is always reachable.
Component docs own outage behavior.

Atlas assumes clocks are synchronized well enough for normal use. Exact agreement
is not required. Large clock errors are outside the current design.

## Hosting is flexible

Core usually runs on an internet-hosted server. It can also run on a computer with
the field team, alongside a gateway. Nearby operators need local access when that
field computer loses internet.

The deployment chooses how to expose Core. Cloudflare Tunnel is one example used
by the owner. It is not a built-in requirement for Atlas.

## Current use keeps some demands modest

The immediate use is trusted testing and flights lasting a few hours.
Keeping a run's records until Reset is therefore acceptable. That duration describes
current use, not a permanent limit on Atlas.

Edge Assets normally need current information. Interfaces and fusion may need
history. Historical transfers must respect the live field traffic.
Observations can come from radios, cameras, radar, and external data services.
Accepting that variety of evidence is a separate problem from processing it.

[Using Atlas](using-atlas.md) shows the responsibilities around these links.
