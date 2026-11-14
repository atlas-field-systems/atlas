# Asset communications

The communications module carries requests from Core to the Asset's modules, and
reports back. This behavior is planned, not implemented.

## One interface for every link

- **On IP**, the module uses the [SDK](../../sdk/README.md) client to make the
  [Core API's Asset calls](../../core/docs/api.md#asset-and-gateway-calls) over
  HTTPS and follow its event stream.
- **On radio**, it uses a [Fieldlink](../../fieldlink/README.md#two-kinds-of-fieldlink).
  When the Fieldlink has an Asset side, the module runs it, and the Fieldlink's
  gateway side runs on the gateway, which makes the Core API calls for the Asset. The Asset holds no Core
  key and never calls the Core API. It authenticates to its gateway through its
  Fieldlink, as [every Fieldlink provides](../../fieldlink/README.md#what-every-fieldlink-provides),
  and learns its `asset_id` for the run from the gateway.
  The Fieldlink owns
  compact encoding, retries, duplicate handling, contact timing, and link
  security for its medium ([walled city](../../atlas/design-decisions.md#a-walled-city)).

Inside the Asset, both use one interface to receive requests in event order,
send reports, and track contact. The rest of the Asset code is the same either
way.
When the Fieldlink is gateway-only, as
[SiK](../../fieldlink/sik/README.md) does for the
[first setup](assets.md#ardupilot-quadcopter), the app reaches Core through the
gateway's connection, and the radio is an equipment-driver connection to the
flight controller, not an Atlas link.

## Requests and reports

The module hands each request to the responsible module once, in event order,
and keeps the last `event_id` it handled so a reconnect
[resumes after it](../../core/docs/api.md#the-event-log-and-live-stream).

Reports go in batches. The module keeps each batch, including every final Task
report, until it is acknowledged, and resends it under the same idempotency key
until then. Through a Fieldlink, the Fieldlink acknowledges end to end. Retained
history catches up through the same calls, with original times.

## Contact

On IP, contact follows the [Core API's contact rule](../../core/docs/api.md#contact).
On radio, the Fieldlink supplies it. Contact loss is an input to
[failsafe conditions](failsafes.md#configure-conditions-as-well-as-responses).
Contact is not freshness. Hearing from Core proves nothing about measurements.

## Report from local state

Behavior modules and equipment drivers update the
[Asset's local state](assets.md#local-state-and-data-flow). The communications
module reads it and chooses which reports to send. On a slow link it fills the
airtime it has with the most useful data, as
[Scale](../../atlas/scale.md#use-slow-links-fully-and-efficiently) sets out:

- **One waiting slot per item, newest value wins.** Position, battery, each
  subsystem, and each Observation hold only their latest unsent value. A newer
  value replaces an older one that has not gone out, so the link never carries
  data that is already out of date.
- **Most important first.** Task outcomes and answers to requests go first and
  must arrive. Then changes that matter, such as a failsafe, a fault, or a new
  or moved Observation. Then current telemetry. Retained history goes last,
  only when nothing live is waiting.
- **As often as the link allows.** There is no fixed reporting rate on a slow
  link. A quiet link carries telemetry often and a busy one less often. On a
  fast link such as IP, the Asset reports on change.

Sending fewer measurements never drops a Task outcome or presents an old
measurement as fresh. Local acquisition and execution never wait on reporting.

The module also tells other modules when internet access is available, for
modules that call external APIs. A field radio is not assumed to carry internet
traffic.

## Several links

Initial Assets use one link: Wi-Fi, FLRC, or LoRa. A later Asset may have
several, for example Wi-Fi nearby, FLRC farther out, and LoRa at the edge of
range, and report in less detail as link capacity decreases. The best path
depends on current conditions, not a fixed ranking of radio types. A nearby
radio peer does not show that Core is reachable.

Some Assets may join known Wi-Fi networks, for example for setup work such as
setting the clock, or for large transfers of retained reports. Wi-Fi is then
one of that Asset's links. It is a possibility, not a requirement: no part of
Atlas assumes an Asset connects to Wi-Fi during startup or setup.

## Open

- The exact order within each priority, and what counts as a change that matters
  for each kind of report.
- **Proposal:** the link asks the Asset for up to a given number of bytes
  whenever it has airtime to spend, and the Asset answers with its most
  important waiting reports. Today the [Asset link](../../sdk/docs/asset.md#the-asset-link)
  works the other way: the Asset sends batches and reads a capacity figure.
  Asking fills each chance to transmit without piling reports up behind a busy
  radio. It would change the SDK's Asset link and needs the owner's agreement.
- How several links, and relaying for peers, fit behind the one interface.
