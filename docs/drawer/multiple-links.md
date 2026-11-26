# Switching links and multiple links per Asset

Today each Asset uses one link: either direct IP or one radio network's
Fieldlink ([One link per Asset](../../asset/docs/communications.md#one-link-per-asset),
[ADR-0011](../adr/0011-one-gateway-per-radio-network.md)). Relaying inside one
Fieldlink (including a multi-layer mesh managed behind one gateway) is still one
link and works without this.

## Ideas parked here

- **Switching between links.** One Asset using separate links, such as Wi-Fi
  nearby, FLRC farther out, and LoRa at the edge of range, and choosing the best
  path from current conditions.
- **Joining Wi-Fi to upload later.** A radio Asset joining a known Wi-Fi network
  after a flight to upload retained report history or captured files, or for
  setup work such as setting the clock.

## Identity change needed

Under the current identity rules ([Reset and identity](../../atlas/reset-and-identity.md),
[ADR-0011](../adr/0011-one-gateway-per-radio-network.md)), an Asset on IP
registers with an Asset key and a radio Asset is registered by its one gateway
with no Core key. Switching between Wi-Fi and a radio gateway, or across two
gateways, would register the same vehicle as separate Assets unless Atlas adopts
a shared identity model and coordinates registration, duplicate suppression, and
command routing across links.

Out of the drawer when: an Asset needs to switch between separate links and
Atlas adopts an identity and routing design across them.
