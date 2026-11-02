# Operating environment

Atlas connects operators to physical and digital Assets. Its normal field path
crosses a gateway and a radio link.

## Connectivity evolves

Radio technology, IP connectivity, and edge networks will keep changing.
Atlas is designed around constrained links with different capabilities.
A LoRa-scale data rate is not a ceiling for the whole system.

The likely early direction is a multimode radio with multiple transceivers:

- 2.4 GHz FLRC as the primary field link.
- 915 MHz LoRa for coverage when the FLRC link becomes unreliable.
- Wi-Fi as a possible addition.

The intended flight uses FLRC nearby and LoRa when distance makes FLRC spotty.
FLRC is expected to carry more than single-digit kilobits per second.
The radio project owns the detailed design as the hardware evolves.

Mesh networking is part of this direction, with some participation in Atlas.
Its mechanisms belong in the relevant radio and networking project documentation.

## IP mainly connects the supporting systems

IP primarily connects Core, gateways, and operator interfaces.
Most physical Assets use the available field radios beyond the gateway.
Direct-IP Assets are possible, especially purely digital Assets.

Field links can disappear and return. Atlas cannot assume continuous IP
connectivity to every Asset.

## Gateway implementations can coexist

Different radio systems can have different gateways. For example, an initial
LoRa-only link could have a dedicated LoRa gateway. A later radio system could
have a new gateway while the older gateway continues to be maintained.
Atlas does not assume one permanent gateway design.

## Core is a deliberate dependency

The current direction accepts dependence on Core for Atlas communications to keep
the system simpler. Offline authorization of new work is not a current requirement.
Core dependence does not imply that Core or every field link is always reachable.
Component docs own outage behavior.

## Hosting is flexible

Core usually runs on an internet-hosted server. It can also run on a computer with
the field team, alongside a gateway. Nearby operators need local access when that
field computer loses internet.

The deployment chooses how to expose Core. Cloudflare Tunnel is one example used
by the owner. It is not a built-in requirement for Atlas.

## Current use keeps some demands modest

The immediate use is trusted testing and flights lasting a few hours.
This makes keeping a run's records until Reset acceptable. That duration describes
current use, not a permanent limit on Atlas.

Edge Assets normally need current information. Interfaces and fusion may need
history. Historical transfers must respect the live field traffic.
Observations can come from radios, cameras, radar, and external data services.
Accepting that variety of evidence is a separate problem from processing it.

[Using Atlas](using-atlas.md) shows the responsibilities around these links.
