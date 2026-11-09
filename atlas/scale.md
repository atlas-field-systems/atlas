# Scale

How big Atlas is meant to be. These are guiding numbers for design, not hard limits.
Design so Atlas works well at these sizes and does not break just past them.

## Fleet
- **About 20 Assets at most.** Design for this. Going past it should still work, just without promises.
- Because of this, IDs that people read or that cross a field link are 1 to 4 letters or digits, such as `A1` ([the ID rule](CHARTER.md#keep-shared-data-simple)). That gives over a million IDs and keeps field-link frames short.

## Setup
- **One site, one Core, one gateway.** A Core runs one site at a time, and each site has exactly one gateway at a time. Different sites, or later radio systems, may use different gateway designs ([Environment](environment.md)).
- **One operator.** Realistically one person runs Atlas at a time.

## Radio
- **Links:** pure LoRa at first, then a multi-layer mesh with FLRC between Assets wherever FLRC is viable ([Environment](environment.md#connectivity-evolves)).
- **Telemetry rate depends on the link:** about every 15 seconds on LoRa, about every second on FLRC.
- **Frame size:** each Fieldlink sets its own size limit and splits records into chunks if it needs to. Protocol records have no size cap and no chunking. About 200 bytes per frame is a goal for slow links, not a limit.
- **Tasks go before telemetry** when the radio is busy. Expect a few Tasks or settings changes per minute per Asset.

## Runs and storage
- **Mission length:** up to about 2 hours per run, set by battery. Core should run all day across many runs.
- **Reset ZIPs:** each can be up to about 1 GB. Size is not a concern.
- **Storage:** Core keeps at least the last 30 days of runs before old ones are removed.
