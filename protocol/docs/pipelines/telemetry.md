# Pipeline: telemetry

How one telemetry report moves from an Asset to the operator, hop by hop. It uses first-flight message 12. Sizes are minified JSON / deflate, in bytes.

**Bloat is the enemy, but good organization is not bloat.** Telemetry is the most frequent message, so every byte here counts most.

```text
Asset ──1. radio──▶ Gateway ──2. IP──▶ Core ──3. store──▶ Core storage
                                        │
                                        └──4. to operator──▶ Operator interface
```

## 1. Asset → gateway
- **Who:** the Asset sends it, and the gateway receives it over radio.
- **Message** (236 / 170):

  ```json
  {"type":"report.telemetry","time":1793667609000,"seq":9,"from":"A1","asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":15,"altitude_reference":"launch"}]},"ground_speed_mps":0,"heading_deg":0}
  ```
- **Bloat:**
  - `"altitude_reference":"launch"` repeats in every report, though it rarely changes.
  - `ground_speed_mps` and `heading_deg` are sent even when they are 0 or unchanged.
  - `"type":"report.telemetry"` is 24 characters. Link compression shrinks it; the name stays readable.
  - Radio compression (chosen later) will remove some of this, but not the repeated values.

## Battery
The battery is its own fixed report, `report.battery` (103 / 88), sent on its own schedule along the same path. It changes even when the Asset does not move, so it no longer rides along in every telemetry report:

```json
{"type":"report.battery","time":1793667601100,"seq":6,"from":"A1","asset_id":"A1","battery_percent":98}
```

## 2. Gateway → Core
- **Link:** IP, through the [SDK front door](https://github.com/atlas-field-systems/monorepo/blob/main/protocol/sdk/how-it-works.md#one-front-door). Its behavior is locked for 0.8; the SDK runtime is not built yet. Each medium's transport adapter and link profile own how bytes cross that link ([Communication](../communication.md#one-model-for-every-link)).
- **Bloat:** the gateway should pass the message on unchanged. It should not wrap it or add fields Core can work out itself.

## 3. Core stores it
- Core adds a row to its `telemetry` table: `asset_id`, time, position, speed and heading ([Storage](../storage.md)).
- **Bloat:** do not split it into separate position and speed records. That would repeat `asset_id` and `time` in each.

## 4. Core → operator interface
- To read stored telemetry, an operator interface sends `query.core` of kind `history` with `report: telemetry` (161 / 120). Core answers with the stored reports, then `admin.reply` to mark the end. That hop is the operator WebSocket.
- Live, Core forwards each new report unchanged ([Operator interfaces](../communication.md#operator-interfaces)).
- **Bloat:** if the operator only needs the latest picture, Core could forward only the newest report per Asset and drop older ones.
