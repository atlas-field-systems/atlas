# Core API

How every program outside Core's inner wall talks to Core: the Command Interface,
Assets on IP, and gateways. Selected design, not implemented. Record shapes belong
to [Protocol](../../protocol/README.md); this page names them and never redefines
their fields. The [walled city](../../atlas/design-decisions.md#a-walled-city)
explains why the API is the only way in.

## Basics

- HTTPS and JSON. Request and event bodies are Protocol records, or small request
  objects built from Protocol variables.
- **Accepted is not done.** A request that Core passes to an Asset returns `202`
  with the request's `event_id`. Task states and setting values change only from
  the Asset's reports.
- **Compatibility.** Every request carries `Atlas-Definitions: <hash>`, the hash
  of the Protocol definitions the caller uses. Core refuses a missing or different
  hash with `409 definitions_mismatch`. `GET /about` needs no credential and
  returns `core_version`, `protocol_version`, and `definitions_hash`. The event
  stream takes the hash as `?definitions=`, because browsers cannot set headers on it.
- **Retries are safe.** Every request that changes state carries an
  `Idempotency-Key` of up to 64 characters. Core keeps each key's response for the
  run. A repeat returns that response and changes nothing; the same key with a
  different body is refused with `409`.
- **Errors** are a status and `{"error": "<code>", "explanation": "<text>"}`.

| Status | Meaning |
| --- | --- |
| `400 invalid` | The body fails Protocol's validator; `explanation` lists the paths |
| `401` | No valid session or key |
| `403` | The caller may not do this, such as an Asset reading another Asset |
| `404` | No such Asset, Task, or account |
| `409` | Refused: Asset offline, command not supported, stale queue version or a list waiting, unknown Task, or definitions mismatch |

## Callers and credentials

| Caller | Credential | Event stream shows |
| --- | --- | --- |
| Account (admin or operator) | Session cookie from `POST /login` | Everything |
| Asset | Bearer key | Requests for that Asset |
| Gateway | Bearer key | Requests for the Assets it carries |

- Accounts log in with `operator_id` and a password. Core stores password hashes
  (scrypt). The session cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`, and
  Core accepts state changes only as JSON, so other sites cannot send them.
- Asset and gateway keys are 16 random bytes as 22 characters of base64url. Core
  stores only their hashes and shows a key once, when an admin creates it.
- The first admin account comes from [Core configuration](../config.md).
- How a gateway is bound to the Assets it carries is part of gateway design, which
  is deferred.

## The event log and live stream

Every accepted request and every stored report adds one event, written in the same
transaction as the change it records ([storage](storage.md)). Each event is `{event_id, time, kind, record}`: a rising integer, Core's receive
time in milliseconds, one of the kinds below, and its record.

| Kind | Added when | Record |
| --- | --- | --- |
| `asset.provisioned`, `asset.removed` | An admin adds or removes an Asset | The Asset's ID and type |
| `asset.described` | The Asset sends its description | Its description record |
| `asset.contact` | Core's view of the Asset's contact changes | `asset_id`, online or offline, last heard |
| `task.requested` | An operator creates a Task | The Task body, with `task_id` and `requested_by` |
| `queue.requested` | Core sends the Asset a new list | `asset_id`, `queue_version`, `now`, and every Task body in order |
| `task.dropped` | Core discards a waiting Task it never sent | `asset_id`, `task_id` |
| `settings.requested` | An operator changes settings | `asset_id`, `settings`, `requested_by` |
| `cancel.requested` | An operator cancels a Task | `asset_id`, `task_id`, `requested_by` |
| `report.<name>` | Core stores an Asset report | The report record |

`GET /events?after=<event_id>&asset_id=<id>` is a Server-Sent Events stream. Each
message has `id: <event_id>`, `event: <kind>`, and the event as `data`. Both
parameters are optional. A browser that reconnects sends `Last-Event-ID`, and Core
resumes after it. Core sends a `: alive` comment every 10 s.

- **Snapshots resume cleanly.** Every read returns `as_of`, the last `event_id` it
  includes. A page loads a snapshot, then follows `/events?after=<as_of>`. This is
  how a refresh or a new tab recovers everything.
- **Readers never pile up in memory.** Core streams from the `events` table. When a
  reader cannot keep up, Core closes its stream and the reader resumes from its
  last `event_id`.
- **The cursor is the duplicate check.** A reader handles each `event_id` once and
  resumes after the last one it handled, so nothing is missed or repeated.

## Operator requests

| Request | Body | Result |
| --- | --- | --- |
| `POST /assets/{asset_id}/tasks` | One command kind and its fields, or a `settings` change; optional `now` | `202 {task_id, event_id}` |
| `PUT /assets/{asset_id}/queue` | `queue_version` and `task_ids`, in order | `202 {event_id}` |
| `PATCH /assets/{asset_id}/settings` | `settings`, as end states | `202 {event_id}` |
| `POST /assets/{asset_id}/tasks/{task_id}/cancel` | Nothing | `202 {event_id}` |

- Core validates the body, checks that the Asset is online and supports the
  command or settings, and assigns `task_id` (1 to 4 letters or digits, unique per
  Asset for the run). Commands to an offline Asset are refused; Core holds nothing.
- **One list in flight.** Core sends an Asset at most one list at a time: a
  `queue.requested` event carrying every Task body, built on the Asset's latest
  reported list and `queue_version`. The Asset's queue report naming that event
  answers it.
- A new Task joins the end of the list. While a list is in flight, new Tasks wait
  in Core and go out together in the next list, built on the Asset's answer, so
  Tasks sent back to back all arrive, in order.
- With `now`, a Task replaces the list and runs at once, even while the Asset is
  paused. It goes out immediately and discards waiting Tasks.
- When the Asset goes offline or a `now` Task goes out, Core discards waiting
  Tasks and adds `task.dropped` for each. They never reached the Asset.
- `PUT /queue` reorders or drops Tasks that have not started. Core refuses it
  unless its `queue_version` is the Asset's latest report and nothing is waiting.
- Cancel names one Task. The Asset cancels it whether it is queued or running.

## Reads

| Request | Returns |
| --- | --- |
| `GET /assets` | Every Asset: description, contact, latest reports, each setting's latest value, and its queue |
| `GET /assets/{asset_id}` | One Asset, the same way |
| `GET /assets/{asset_id}/tasks` | Task bodies, latest states, and queue order |
| `GET /history?asset_id&report&since&until&cursor&limit` | Stored reports ordered by report time, then `event_id`; at most 1000 per page, with `next_cursor` |

## Asset and gateway calls

An Asset on IP starts or reconnects in this order:

1. `GET /about` and compare the definitions hash.
2. `PUT /assets/{asset_id}/description` with its description record.
3. `POST /assets/{asset_id}/reports` with its known settings, its queue if it has
   one, and any final Task reports Core has not yet acknowledged.
4. Open `/events?after=<last handled event_id>`. On first start, it follows from
   the latest event.

- `POST /assets/{asset_id}/reports` takes `{"reports": [...]}` in batches. A `200`
  stores and acknowledges the whole batch. The Asset resends a batch with the same
  `Idempotency-Key` until it gets one. Retained reports catching up after a gap use
  the same call with their original times.
- A report that answers a request names it with `request_id`, the request's
  `event_id`. Task reports name their `task_id`.
- The Asset applies `queue.requested` only when it was built on its current
  `queue_version`, unless `now` is set. A list arrives whole, so it takes effect at
  once. The Asset reports Tasks from an ignored list it never held as `cancelled`.
- Settings requests apply in event order. [Asset behavior](../../asset/docs/README.md)
  owns execution, failsafes, and the overrides allowed during a failsafe.

A gateway makes the same calls on behalf of each Asset it carries, with its own
key, and reports each Asset's contact as its Fieldlink observes it. Core trusts
the gateway for which Asset sent what: a gateway key covers every Asset it
carries, and proving a single Asset's identity across the radio is
[not designed yet](#not-defined-yet).

## Contact

- **Core's view.** An Asset is online while its event stream is open or Core has
  stored a report from it within `offline_after_s`
  ([configuration](../config.md)). Through a gateway, Core uses the gateway's
  contact reports. Core adds an `asset.contact` event when this changes.
- **The Asset's view.** On IP, the Asset is in contact while its stream is open
  and data or keepalives arrive. It loses contact after its `link_loss_after_s`
  with neither. Through a Fieldlink, the Fieldlink supplies contact. Contact loss
  is an input to the Asset's [failsafe conditions](../../asset/docs/failsafes.md).

## Accounts and provisioning

Admin-only, except login, logout, and `GET /me`.

| Request | Purpose |
| --- | --- |
| `POST /login`, `POST /logout`, `GET /me` | Start, end, and read a session |
| `POST /accounts`, `DELETE /accounts/{operator_id}` | Add or remove an admin or operator account |
| `POST /assets` | Provision an Asset; returns its `asset_id` and key once |
| `POST /assets/{asset_id}/key` | Replace an Asset's key; returns the new key once |
| `DELETE /assets/{asset_id}` | Remove an Asset |
| `POST /gateways`, `DELETE /gateways/{gateway_id}` | Provision or remove a gateway |

## Not defined yet

- Reset: the request, the archive, and what it clears. [Storage](storage.md#runs)
  defines what a run is.
- Gateway binding to Assets, and the Fieldlink docs.
- Per-Asset authentication across a Fieldlink. Until it exists, any node that
  can send on a gateway's radio channel can claim to be any Asset that gateway
  carries.
- The Protocol records this page names, as Protocol moves from messages to records.
- Plugins, geo features, Objects, Observations, and Tracks, parked until after
  first flight.
