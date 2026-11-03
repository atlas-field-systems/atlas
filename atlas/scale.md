# Scale

How big Atlas is meant to be. These are guiding numbers for design, not hard limits.
Design so Atlas works well at these sizes and does not break just past them.

## Fleet
- **About 20 Assets at most.** Design for this. Going past it should still work, just without promises.
- Because of this, an Asset ID is 1 to 4 letters or digits (such as `A1`). That gives millions of IDs and keeps every message short.

## Setup
- **One site, one Core, one gateway.** A Core runs one site at a time, and each site has exactly one gateway.
- **One operator.** Realistically one person runs Atlas at a time.

## Radio
- **Telemetry rate depends on the link:** about every 15 seconds on LoRa, about every second on FLRC.
- **Message size:** aim for a couple hundred bytes (about 200) after compression. Treat 255 bytes as the ceiling, about the largest single packet these radios carry.
- **Bigger messages are split.** A message over the ceiling is split into chunks, sent chunk by chunk, and put back together when it arrives. The chunk format will be defined in the protocol later.
- **Commands go before telemetry** when the radio is busy. Expect a few commands per minute per Asset.

## Runs and storage
- **Mission length:** up to about 2 hours per run, set by battery. Core should run all day across many runs.
- **Reset ZIPs:** each can be up to about 1 GB. Size is not a concern.
- **Storage:** Core keeps at least the last 30 days of runs before old ones are removed.
