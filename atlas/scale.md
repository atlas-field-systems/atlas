# Scale

These numbers guide Atlas design. They are not hard limits.
Design so Atlas works well at these sizes and does not break just past them.

## Fleet
- Atlas has no set fleet size. An early figure of about 20 Assets was a rough guess, not a requirement or a test. How many Assets a field link carries is whatever its measured airtime allows.
- IDs that people read or that cross a field link are 1 to 4 letters or digits, such as `A1` ([the ID rule](CHARTER.md#keep-shared-data-simple)). That gives over a million IDs and keeps field-link frames short.

## Setup
- A Core may run several gateways at once, as long as their radio links cannot clash: gateways in different areas, such as two gateways 20 miles apart, or gateways in one area on different bands, such as an FLRC gateway beside a Meshtastic gateway. Each radio network has exactly one gateway, and the network is a mesh of Assets. An Asset always uses exactly one gateway. Different gateways may use different designs ([Environment](environment.md)).
- In practice, one operator runs Atlas at a time.

## Radio
- Links start with pure LoRa, then move to a multi-layer mesh with FLRC between Assets wherever FLRC is viable ([Environment](environment.md#connectivity-evolves)).
- Each Fieldlink sets its own size limit and splits records into chunks if it needs to. Protocol records have no size cap and no chunking.
- Expect a few Tasks or settings changes per minute per Asset.

### Use slow links fully and efficiently

On a slow link such as LoRa, airtime is the scarce thing, and Atlas spends all of it well.

- **Send as much as the link carries.** Airtime left unused while an Asset has useful data is wasted. There is no fixed telemetry rate: an Asset reports as often as free airtime allows, more often on a quiet link and less often on a busy one.
- **Spend every byte well.** The most important data goes first, and airtime never carries data that is already out of date or that the other end already has.

[Asset communications](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/communications.md#report-from-local-state)
owns what an Asset chooses to send, and each Fieldlink owns how compactly it
carries it ([Fieldlink](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/README.md#the-fieldlink-moves-messages-the-asset-decides)).

## Runs and storage
- Each run lasts up to about 2 hours, limited by battery. Core should run all day across many runs.
- Each Reset ZIP can be up to about 1 GB. Size is not a concern. The owner deletes old ZIPs by hand.
