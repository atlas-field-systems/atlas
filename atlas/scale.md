# Scale

These numbers guide Atlas design. They are not hard limits.
Design so Atlas works well at these sizes and does not break just past them.

## Fleet
- Design for about 20 Assets at most. Larger fleets should still work, but without guarantees. The number is a goal, not a requirement: a field link may carry fewer.
- At this scale, IDs that people read or that cross a field link are 1 to 4 letters or digits, such as `A1` ([the ID rule](CHARTER.md#keep-shared-data-simple)). That gives over a million IDs and keeps field-link frames short.

## Setup
- A Core may run several gateways at once, as long as their radio links cannot clash: gateways in different areas, such as two gateways 20 miles apart, or gateways in one area on different bands, such as an FLRC gateway beside a Meshtastic gateway. Each radio network has exactly one gateway, and the network is a mesh of Assets. An Asset always uses exactly one gateway. Different gateways may use different designs ([Environment](environment.md)).
- In practice, one operator runs Atlas at a time.

## Radio
- Links start with pure LoRa, then move to a multi-layer mesh with FLRC between Assets wherever FLRC is viable ([Environment](environment.md#connectivity-evolves)).
- The telemetry rate is about every 15 seconds on LoRa and about every second on FLRC.
- Each Fieldlink sets its own size limit and splits records into chunks if it needs to. Protocol records have no size cap and no chunking. About 200 bytes per frame is a goal for slow links, not a limit.
- Tasks go before telemetry when the radio is busy. Expect a few Tasks or settings changes per minute per Asset.

## Runs and storage
- Each run lasts up to about 2 hours, limited by battery. Core should run all day across many runs.
- Each Reset ZIP can be up to about 1 GB. Size is not a concern. The owner deletes old ZIPs by hand.
