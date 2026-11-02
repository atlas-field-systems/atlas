# Operating environment

Atlas connects operators to physical and digital Assets. Its normal field path
crosses a gateway and a radio link.

## IP mainly connects the supporting systems

IP primarily connects Core, gateways, and operator interfaces.
Most physical Assets use FLRC, LoRa, or both beyond the gateway.
Direct-IP Assets are possible, especially purely digital Assets.

Field links can disappear and return. Bandwidth is a design constraint, not an
assumption of continuous IP connectivity to every Asset.
The operator has described LoRa throughput as roughly single-digit kilobits per
second, with uncertainty. That is an expectation, not a fixed Protocol budget.

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
