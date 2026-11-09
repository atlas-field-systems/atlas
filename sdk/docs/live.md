# Live

How the SDK follows Core's event log. Event shapes, kinds and the stream format
are in [The event log and live stream](../../core/docs/api.md#the-event-log-and-live-stream).

## Following the stream

```ts
const follow = atlas.follow({ after, asset_id }, async (event) => { /* ... */ });
follow.cursor;   // last handled event_id
follow.stale;    // true while disconnected
follow.stop();
```

- **Start from a snapshot.** A program loads a read, then follows with `after`
  set to that read's `as_of`. That is how a page load, a refresh, or a new tab
  recovers everything. Without `after`, the stream starts from the latest event.
- **One event at a time, in order.** The handler gets each event once, in
  `event_id` order. The cursor advances only when the handler returns or its
  promise resolves. If the handler throws, the follow stops at the last handled
  event and reports the error; the program decides whether to resume.
- **The cursor is the duplicate check.** The client resumes after the last event
  it handled, so nothing is missed or repeated. There is no dedupe window.
- **The cursor lives in memory.** The client exposes it and takes `after`, so a
  host that must resume across a restart can store it.

## Reconnecting

The client opens `/events?after=<cursor>` itself and manages reconnects, in the
browser and in Node alike.

- When the stream closes or errors, the client reopens it with backoff
  ([configuration](../config.md)). A stream that Core closed because the reader fell
  behind is reopened the same way.
- With neither data nor a `: alive` comment for the idle timeout, the client
  treats the stream as dead and reopens it.
- `stale` is true from the moment the stream drops until it reopens. Reads of
  local state stay available and say they are stale.
- A `401` stops reconnecting, as in [Credentials](client.md#credentials). A
  definitions mismatch stops the client.

The client reports each open, close, and keepalive to the host, so an Asset can
apply its own [contact rule](../../core/docs/api.md#contact).

## Live picture

An optional in-memory view of Assets and Tasks for operator apps. Assets do not use it.

```ts
const picture = createLivePicture(atlas, { asset_id });   // asset_id optional
picture.assets();        // { ready, stale, items }
picture.tasks(asset_id); // { ready, stale, items }
picture.onChange(cb);
```

- **Loading.** It reads `GET /assets` and each Asset's `GET /assets/{asset_id}/tasks`
  ([Reads](../../core/docs/api.md#reads)), then follows from the smallest `as_of`.
  For each part, it skips events at or below the `as_of` of the read that loaded it.
- **Readiness is explicit.** Reads return `{ready, stale, items}`. Until loading
  finishes, `ready` is false; a read never returns an empty list as if it were true.
- **Per-setting latest values.** A `report.settings` changes only the settings it
  contains. Each setting keeps its own latest value and the report it came from,
  ordered by report time and then `event_id`, so a retained report that catches up
  after a gap never replaces a newer value.
- **Evidence stays separate.** Requests show as requested until reports arrive.
  Contact comes from `asset.contact` events. Neither stream state nor picture
  readiness means the equipment is ready.
- **On disconnect** the picture keeps its data with `stale: true` and resumes from
  its cursor on reconnect. It keeps nothing on disk.
