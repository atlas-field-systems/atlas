# Pipeline: telemetry

How one telemetry report moves from an Asset to the operator, hop by hop. It uses first-flight message 12. Sizes are minified JSON / deflate, in bytes.

**Bloat is the enemy, but good organization is not bloat.** Telemetry is the most frequent message, so every byte here counts most.

```text
Asset ──1. radio──▶ Gateway ──2. IP (GAP)──▶ Core ──3. store (GAP)──▶ Core storage
                                              │
                                              └──4. to operator (GAP)──▶ Operator interface
```

## 1. Asset → gateway
- **Who:** the Asset sends it, and the gateway receives it over radio.
- **Message** (222 / 165; it was 243 / 176 with the battery inside):

  ```json
  {"type":"report.telemetry","time":1793667609000,"seq":8,"asset_id":"A1","position":{"latitude":42.2746,"longitude":-71.8063,"altitudes":[{"altitude_m":15,"altitude_reference":"home"}]},"ground_speed_mps":0,"heading_deg":0}
  ```
- **Bloat:**
  - `"altitude_reference":"home"` repeats in every report, though it rarely changes.
  - `ground_speed_mps` and `heading_deg` are sent even when they are 0 or unchanged.
  - `"type":"report.telemetry"` is 24 characters. Short keys are deferred to 1.0.
  - Radio compression (chosen later) will remove some of this, but not the repeated values.

## Battery
The battery is its own fixed report, `report.battery` (91 / 82), sent on its own schedule along the same path. It changes even when the Asset does not move, so it no longer rides along in every telemetry report:

```json
{"type":"report.battery","time":1793667601100,"seq":5,"asset_id":"A1","battery_percent":98}
```

## 2. Gateway → Core
- **Link:** IP. **GAP:** the Core-to-gateway API (in the SDK) is not defined.
- **Bloat:** the gateway should pass the message on unchanged. It should not wrap it or add fields Core can work out itself.

## 3. Core stores it
- **GAP:** the storage layout is deferred. Sketch, not decided: the message as received, plus one receive time.
- **Bloat:** do not split it into separate position and speed records. That would repeat `asset_id` and `time` in each.

## 4. Core → operator interface
- To read stored telemetry, an operator interface sends `query.core` of kind `history` with `report: telemetry` (126 / 101). Core answers with the stored reports, unchanged. That hop is the operator API, which is not defined yet.
- **GAP:** not defined. Sketch, not decided: Core forwards the same message.
- **Bloat:** if the operator only needs the latest picture, Core could forward only the newest report per Asset and drop older ones.
