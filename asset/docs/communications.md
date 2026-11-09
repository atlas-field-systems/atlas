# Asset communications

The communications module carries requests from Core to the Asset's modules, and
reports back. Planned behavior, not implemented.

## One interface for every link

- **On IP**, the module uses the [SDK](../../sdk/README.md) client to make the
  [Core API's Asset calls](../../core/docs/api.md#asset-and-gateway-calls) over
  HTTPS and follow its event stream.
- **On radio**, it uses a Fieldlink. The same Fieldlink package runs on the
  gateway, which makes the Core API calls for the Asset. The Fieldlink owns
  compact encoding, retries, duplicate handling, contact timing, and link
  security for its medium ([walled city](../../atlas/api-proposal.md#the-shape)).

Inside the Asset, both sit behind one interface: requests in event order,
reports out, and contact. The rest of the Asset code is the same either way.
Gateway and Fieldlink design is deferred, including the link the
[first setup](assets.md#ardupilot-quadcopter) uses. Its SiK radio is an
equipment-driver connection to the flight controller, not an Atlas link.

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
Contact is not freshness: hearing from Core proves nothing about measurements.

## Report from local state

Behavior modules and equipment drivers update the
[Asset's local state](assets.md#local-state-and-data-flow). The communications
module reads it and chooses which reports to send and how often, by data
relevance and the link's quality and capacity. It can report on change, on an
interval, or as capacity allows. Sending fewer measurements never drops a Task
outcome or presents an old measurement as fresh. Local acquisition and execution
never wait on reporting.

The module also tells other modules when internet access is available, for
modules that call external APIs. A field radio is not assumed to carry internet
traffic.

## Several links

Initial Assets use one link: Wi-Fi, FLRC, or LoRa. A later Asset may have
several, for example Wi-Fi nearby, FLRC farther out, and LoRa at the edge of
range, and report in less detail as the path narrows. The best path depends on
current conditions, not a fixed ranking of radio types. A nearby radio peer does
not show that Core is reachable.

## Open

- Reporting thresholds, rates, and priorities under congestion.
- How several links, and relaying for peers, fit behind the one interface.
- Gateway and Fieldlink design, including the first-flight link.
