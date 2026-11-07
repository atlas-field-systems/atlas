# Live picture

An optional in-memory view of Assets and Tasks for operator apps. Assets do not
need it.

## How it behaves (D4)

- **Default:** on-demand reads (`request` / `stream` / queries).
- **Opt-in:** a live in-memory picture of Assets and Tasks, read through the same
  calls. Rebuilt from Core's connect push (`admin.describe` + latest reports)
  after every connect; no disk cache, and no resuming a local cache without that
  replay. The replayed messages are delivered to the picture even if it has seen
  them.
- **Readiness is explicit.** While loading, reads say so; they never return an
  empty list as if it were true.
- **On disconnect:** last snapshot stays readable with `stale: true` (ready may
  stay true with that flag). Auth loss can still expose the last snapshot
  read-only while network sends stop.
- Assets do **not** need the live picture for v1.

## Module: `picture.mjs`

```js
export function createLivePicture(link): Picture
Picture = {
  ready: boolean, stale: boolean,
  assets(): { ready, stale, items: Map<asset_id, {
    describe?, latest: Map<type#kind, Message>,
    settings: Map<settingName, { value, report: Message }>
  }> },
  tasks(assetId?): { ready, stale, items },
  onChange(cb): () => void
}
```
- `ready=false` until the picture's own `query.core kind assets` request gets its `admin.reply` (decided, P2 in the [implementation plan](../IMPLEMENTATION.md#9-current-implementation-points)). No protocol change.
- Upsert by `(from, seq, time)`. When a value for the same slot (asset + type#kind) is replaced, the newest `time` wins. Duplicates are delivered, so a replay refills the picture.
- Settings are the exception to whole-message replacement. Keep each setting's
  newest value and source report independently, using the Asset report's `time`
  and then its `seq` when times match. Never order effects by operator-request
  timestamps.
  A partial `report.settings` changes only the settings it contains. For example,
  a newer gear-only report keeps the lights value from an earlier report.
  Replay all settings reports in Core's connect push into this map. A single
  `latest` entry for `report.settings` is not a complete settings snapshot.
- On disconnect, `stale=true` and data is kept. On reconnect, rebuild from scratch (no disk).
- Reads return `{ready, stale, items}` and never a bare empty list.
- Assets do not need it.
