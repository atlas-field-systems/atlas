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

After an interface refreshes, the SDK must retrieve Task bodies, latest outcomes,
and queue order. A Task ID and state do not describe its destination or requested
settings. The connect push and `query.core kind assets` do not supply all of this.
Define the [retrieval exchange](../../protocol/docs/open-questions.md#unresolved)
before treating the Task picture as ready.

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
- Settings need retention beyond whole-message replacement. Keep each setting's
  newest value and source report independently, using the Asset report's `time`
  and then its `seq` when times match. Never order effects by operator-request
  timestamps.
  A partial `report.settings` changes only the settings it contains. For example,
  a newer gear-only report keeps the lights value from an earlier report.
  Replay all settings reports in Core's connect push into this map. A single
  `latest` entry for `report.settings` is not a complete settings snapshot.
- Retain subsystem conditions independently under [Protocol storage rules](../../protocol/docs/storage.md).
  The `latest` map alone cannot represent this view. Its exact interface awaits
  [the subsystem contracts](../../protocol/docs/open-questions.md#unresolved).
- Keep settings support separate from currently known setting values. Neither
  link readiness nor picture readiness means equipment is ready.
- On disconnect, `stale=true` and data is kept. On reconnect, rebuild from scratch (no disk).
- Reads return `{ready, stale, items}` and never a bare empty list.
- Assets do not need it.
