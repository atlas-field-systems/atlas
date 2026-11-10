# Core API

The Command Interface, Assets on IP, and gateways use this API to talk to Core
from outside its inner wall. This design is selected but not implemented.
Record shapes belong to [Protocol](../../protocol/README.md); this page names them and never redefines
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
  An Asset or gateway sends its key and hash on `GET /about` too. When that hash
  differs, Core adds a `definitions.refused` event, so operators see why the
  Asset or gateway is missing.
- **Retries are safe.** Every request that changes state carries an
  `Idempotency-Key` of up to 64 characters. Core keeps each key's non-secret
  response for the run. A repeat returns that response and changes nothing; the
  same key with a different body returns `409`. Credential issuance and login
  return secrets only in the first response. Their retained response is a
  non-secret acknowledgment, as [credentials](#callers-and-credentials) defines.
- **Errors** are a status and `{"error": "<code>", "explanation": "<text>"}`.

| Status | Meaning |
| --- | --- |
| `400 invalid` | The body fails Protocol's validator; `explanation` lists the paths |
| `401` | No valid session or key |
| `403` | The caller may not do this, such as an Asset reading another Asset |
| `404` | No such Asset, Task, or account |
| `409` | Refused: Asset offline, queue full, command not supported, unknown Task, or definitions mismatch |

## Root paths

Each Core pillar has a root path, and the kinds that pillar owns live under it.
Plugins are not a pillar; their interface still has a root path, so every
outside system is reached the same way. Fusion has no root path: it works on
Core's state directly, never through this API. `/about`, `/events`, `/history`,
and `/debug` belong to no pillar and stay at the top level.

| Root | Owns |
| --- | --- |
| `/entities` | The shared picture. `GET /entities` returns it. Assets, Observations, Tracks, and geo features live under this root |
| `/tasks` | Tasks, queues, and cancels |
| `/objects` | Files Core holds. Not designed yet |
| `/plugins` | The Plugin interface. Not designed yet |
| `/administration` | Accounts, sessions, keys, and provisioning |

## Callers and credentials

| Caller | Credential | Event stream shows |
| --- | --- | --- |
| Account (admin or operator) | Session cookie from `POST /administration/login` | Everything |
| Asset on IP | Bearer key | Requests for that Asset |
| Gateway | Bearer key | Requests for the Assets it carries |

- Accounts log in with `operator_id` and a password. Core stores password hashes
  (scrypt). The session cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`, and
  Core accepts state changes only as JSON, so other sites cannot send them.
- Asset and gateway keys are 16 random bytes as 22 characters of base64url. Core
  stores only their hashes and shows a key once, when an admin creates or replaces it.
- A successful issuance retry with the same idempotency key returns an
  acknowledgment identifying the Asset or gateway and confirming issuance. It
  returns no bearer key and creates or rotates nothing. Core never retains the
  secret response body in its retry cache, event log, or diagnostic logs.
- If the first issuance response is lost, the key cannot be recovered. The admin
  uses the returned ID to replace the Asset or gateway key with a new
  idempotency key. Replacement invalidates the previous key and shows the new
  key once. Retrying that replacement only acknowledges it; if its first
  response is lost too, replace again with a new idempotency key.
- A successful login creates a session and sends its cookie only in the first
  response. Core stores only the session token's hash. Repeating the login with
  the same idempotency key and body acknowledges the login without creating a
  session or sending `Set-Cookie`. The retry cache never holds a recoverable
  cookie. A caller that missed the cookie logs in with a new idempotency key to
  create a new session. A caller that received it keeps using that session;
  the acknowledgment alone does not authenticate a caller.
- The first admin account comes from [Core configuration](../config.md).
- An Asset behind a gateway holds no Core key and never calls this API. It
  authenticates to its gateway in whatever way its Fieldlink uses. That design is
  [deferred](#not-defined-yet).

## The event log and live stream

Core adds one event for every accepted request and stored report, in the same
transaction as the change it records ([storage](storage.md)). Each event is
`{event_id, time, kind, record}`: a rising integer, Core's receive time in
milliseconds, one of the kinds below, and its record.

| Kind | Added when | Record |
| --- | --- | --- |
| `asset.provisioned`, `asset.removed` | An admin adds or removes an Asset | The Asset's ID and type |
| `asset.described` | The Asset sends its description | Its description record |
| `asset.contact` | Core's view of the Asset's contact changes | `asset_id`, online or offline, last heard |
| `definitions.refused` | An Asset or gateway connects with a different definitions hash | Its `asset_id` or `gateway_id`, and its hash |
| `tasks.requested` | An operator sends Tasks | Every Task body in the request, in `task_id` order |
| `task.dropped` | Core discards a Task the Asset never confirmed it holds | `asset_id`, `task_id` |
| `request.dropped` | Core stops delivering a request the Asset did not answer before it went offline | `asset_id`, `request_id` |
| `settings.requested` | An operator changes settings | `asset_id`, `settings`, `requested_by` |
| `cancel.requested` | An operator cancels a Task | `asset_id`, `task_id`, `requested_by` |
| `report.<name>` | Core stores an Asset report | The report record |

`GET /events?after=<event_id>&asset_id=<id>` is a Server-Sent Events stream. Each
message has `id: <event_id>`, `event: <kind>`, and the event as `data`. Both
parameters are optional. A browser that reconnects sends `Last-Event-ID`, and Core
resumes after it. Core sends a `: alive` comment every 10 s.

- **Snapshots resume cleanly.** Every read returns `as_of`, the last `event_id` it
  includes. A page loads a snapshot, then follows `/events?after=<as_of>`. This is
  how a page recovers after a refresh or in a new tab.
- Core streams from the `events` table. When a reader cannot keep up, Core closes
  its stream and the reader resumes from its last `event_id`.
- **The cursor is the duplicate check.** A reader handles each `event_id` once and
  resumes after the last one it handled, so nothing is missed or repeated.

## Operator requests

| Request | Body | Result |
| --- | --- | --- |
| `POST /tasks/{asset_id}` | `tasks`: one or more Tasks in order, each one command kind and its fields, or a `settings` change; optional `now`, with one Task | `202 {task_ids, event_id}` |
| `PATCH /entities/assets/{asset_id}/settings` | `settings`, as end states | `202 {event_id}` |
| `POST /tasks/{asset_id}/{task_id}/cancel` | Nothing | `202 {event_id}` |

- Core validates the body, checks that the Asset is online and supports every
  command and setting in it, and accepts or refuses the request whole. Core
  refuses commands to an offline Asset and holds nothing.
- **At most 64 Tasks may be outstanding per Asset.** Outstanding work includes
  every accepted Task still crossing the link, held unstarted, or active,
  including work held while paused. Core counts a Task until its final Asset
  report is stored. Dropping an unanswered request alone does not free capacity,
  because it may have reached the Asset. A queue report alone does not prove
  that a missing Task has ended.
  Core checks the total and reserves capacity for the whole request atomically
  with acceptance, so concurrent requests cannot exceed 64. If acceptance would
  exceed 64, Core refuses the whole request with `409 queue_full`, without
  assigning Task IDs or adding accepted work. This includes `now`; expected
  cancellations do not free capacity before final reports. A retry consumes no
  extra capacity. After capacity is freed, a refused caller uses a new
  idempotency key for a new admission attempt.
- **Tasks are numbered.** Core gives each Task the next `task_id` for its Asset:
  1 for the Asset's first Task of the run, then 2, then 3. A `task_id` never
  changes and is never reused. The Asset runs its Tasks in `task_id` order, so
  the order never depends on when a Task arrives.
- **Core sends every Task at once.** Each accepted request is one
  `tasks.requested` event on the Asset's stream. Core never holds a Task back,
  whatever the Asset is doing, so the Asset already has its work if contact ends.
- **Tasks sent together start together.** Each Task of a request carries
  `send_last`, the `task_id` of the request's last Task. The Asset starts none of
  them until it has received all of them. A Task that was cancelled counts as
  received. An operator who wants a whole mission aboard
  before it starts sends the mission in one request.
- **A failure refuses the Tasks sent before Core knew of it.** A failed Task
  [clears the Asset's queue](../../asset/docs/failsafes.md#a-failed-command-cancels-the-remaining-tasks),
  and the Asset counts its clears in `clear_count`. Each Task carries the
  `clear_count` the Asset last reported. The Asset refuses a Task that carries
  another count, because the operator sent it to follow work that no longer
  exists.
- With `now`, a request carries one Task. The Task runs at once, even while the
  Asset is paused, and cancels every Task with a lower `task_id`. The Asset
  accepts it whatever its `clear_count`.
- The Asset answers a Task request with a queue report that names the request
  and lists the Tasks the Asset holds.
- **Unanswered requests end when the Asset goes offline.** Core stops delivering
  every request the Asset has not answered: Tasks, settings changes, and cancels.
  Core adds `request.dropped` for each, and `task.dropped` for each Task the
  Asset never reported holding. The Asset's stream skips dropped requests when it
  returns, so no old request runs late. Core then cancels each dropped Task that
  the returning Asset reports neither holding, nor running, nor ended, so a
  dropped `task_id` never blocks the Tasks after it. An operator who still wants the work sends it again.
- A dropped request may have reached the Asset before contact ended. The Asset's
  later reports say what it did. `request.dropped` does not prove the request
  never arrived.
- Cancel names one Task. The Asset cancels it whether it is queued or running.
  To change the order of Tasks already sent, cancel them and send new ones.

## Reads

| Request | Returns |
| --- | --- |
| `GET /entities/assets` | Every Asset: description, contact, latest reports, and each setting's latest value |
| `GET /entities/assets/{asset_id}` | One Asset, the same way |
| `GET /tasks/{asset_id}` | Task bodies, latest states, and the Tasks the Asset reports holding |
| `GET /history?asset_id&report&since&until&cursor&limit` | Stored reports ordered by report time, then `event_id`; at most 1000 per page, with `next_cursor` |

The rest of the picture is under [Entities](#entities).

## Asset and gateway calls

An Asset on IP starts or reconnects in this order:

1. `GET /about` and compare the definitions hash.
2. `PUT /entities/assets/{asset_id}/description` with its description record.
3. `POST /entities/assets/{asset_id}/reports` with its known settings, its queue if it has
   one, the report of its active Task, and any final Task reports Core has not
   yet acknowledged.
4. Open `/events?after=<last handled event_id>`. On first start, it follows from
   the latest event.

- `POST /entities/assets/{asset_id}/reports` takes `{"reports": [...]}` in batches. A `200`
  stores and acknowledges the whole batch. The Asset resends a batch with the same
  `Idempotency-Key` until it gets one. Retained reports catching up after a gap use
  the same call with their original times.
- A report that answers a request names it with `request_id`, the request's
  `event_id`. Task reports name their `task_id`.
- The Asset keeps the Tasks of each `tasks.requested` and runs its Tasks in
  `task_id` order. It starts a Task only when every lower `task_id` has ended and
  every Task through the Task's `send_last` is held or has ended. A `task_id` the Asset has
  not received blocks the Tasks after it until it arrives or is cancelled.
- The Asset reports a Task `cancelled` without running it in three cases: the
  Task's `clear_count` is not the Asset's own and `now` is not set, a cancel for
  the Task arrived before the Task, or a `now` Task with a higher `task_id` has
  run.
- Settings requests apply in event order. [Asset behavior](../../asset/docs/README.md)
  owns execution, failsafes, and the overrides allowed during a failsafe.
- Core compares each report's `time` with its own clock. Core stores a report
  timed more than `clock_ahead_s` ahead ([configuration](../config.md)), marks
  its event `clock_ahead`, and never uses it as a latest value. Otherwise one
  report from a wrong clock would outrank every correct report until real time
  caught up with it.

A gateway makes the same calls on behalf of each Asset it carries, with its own
key, and reports each Asset's contact as its Fieldlink observes it. Core
authenticates the gateway and trusts it for which Asset sent what. Each Asset
authenticates to the gateway, not to Core.

A gateway runs on its own computer, apart from Core. Its link to Core is IP with
broadband speed, so the gateway follows the event stream for every Asset it
carries, keeps their current state, and sends over the radio only what each
Asset does not already have. Tasks may cross the radio one at a time and in any
order, because the Asset orders them by `task_id`.

## Contact

- **Core's view.** An Asset is online while Core has heard from it within
  `offline_after_s` ([configuration](../config.md)). Core hears from an Asset on
  IP each time the Asset calls the API. Through a gateway, Core uses the
  gateway's contact reports. An open event stream is not evidence of contact. An
  Asset with nothing to report posts an empty report batch often enough to stay
  online. Core adds an `asset.contact` event when its view changes.
- **The Asset's view.** On IP, the Asset is in contact while its stream is open
  and data or keepalives arrive. It loses contact after its `link_loss_after_s`
  with neither. Through a Fieldlink, the Fieldlink supplies contact. Contact loss
  is an input to the Asset's [failsafe conditions](../../asset/docs/failsafes.md).

## Accounts and provisioning

Only admins may use these calls, except login, logout, and `GET /administration/me`.

| Request | Purpose |
| --- | --- |
| `POST /administration/login`, `POST /administration/logout`, `GET /administration/me` | Start, end, and read a session |
| `POST /administration/accounts`, `DELETE /administration/accounts/{operator_id}` | Add or remove an admin or operator account |
| `POST /administration/assets` | Provision an Asset on IP; returns its `asset_id` and key once |
| `POST /administration/assets/{asset_id}/key` | Replace an Asset on IP's key; returns the new key once |
| `DELETE /administration/assets/{asset_id}` | Remove an Asset |
| `POST /administration/gateways`, `DELETE /administration/gateways/{gateway_id}` | Provision or remove a gateway; provisioning returns its `gateway_id` and key once |
| `POST /administration/gateways/{gateway_id}/key` | Replace a gateway key; returns the new key once |

### Credential retry scenarios

These are requirements to test when Core is built; no credential runtime exists yet.

- Provision an Asset or gateway and lose the first response. Retry with the same
  idempotency key and body. Expect the same provisioned ID and an issuance
  acknowledgment, no key, and no second provisioning. Replace its key with a
  new idempotency key; expect one new key and rejection of the old key.
- Lose a replacement response and retry it. Expect acknowledgment without
  another rotation or key. Replace again with a new idempotency key to recover.
- Lose a login response and retry it. Expect acknowledgment without `Set-Cookie`
  or another session. Log in with a new idempotency key to obtain a cookie.
  If the original cookie arrived, verify that the retry leaves it usable.
- Reuse any of these idempotency keys with a different body. Expect `409` and
  no effect. Verify that failed login retries never create a session.
- Inspect stored credential hashes, retry responses, events, and diagnostic
  logs after issuance, replacement, login, and their retries. No bearer key or
  session cookie is recoverable from stored state. Only hashes authenticate
  the presented credentials.

## Debug log

`GET /debug/<segment>/log` serves Core's diagnostic log with no credential while
`debug_endpoint` is on. Core makes the random segment when it starts.
[Core logging](logging.md#read-the-log-while-core-runs) owns it.

## Entities

Entities is the shared picture: Assets, Observations, Tracks, and geo features.
`GET /entities` returns one consistent cut of all four, with `as_of`. The event
stream updates it. The Command Interface draws the map from this read.

Each kind lives under the `/entities` root, because each is written and used
differently.

| Path | Role |
| --- | --- |
| `/entities/assets` | The actor surface, already specified above: description, contact, settings, and reports. Observations an Asset reports arrive here as reports. Provisioning is under `/administration`. Tasks are under `/tasks`. |
| `/entities/observations` | Evidence in the picture, separate from Tracks. Callers read Observations here. They do not create them. Assets write them only as reports. |
| `/entities/tracks` | Conclusions Fusion produced. Callers read Tracks here. They do not create them. Fusion writes Tracks through the Entities pillar's functions, never this API. |
| `/entities/geofeatures` | Places operators and Plugins create, edit, and delete. Tasks may name a `geofeature_id`. |

The request and record shapes for `GET /entities`, `/entities/observations`,
`/entities/tracks`, and `/entities/geofeatures` are not designed yet. Objects
are not Entities.

## Not defined yet

- Reset: the request, the archive, and what it clears. [Storage](storage.md#runs)
  defines what a run is.
- How an Asset authenticates to its gateway. Each Fieldlink decides this for its
  radio, and the Fieldlinks may share nothing. On Meshtastic, for example, an
  Asset could be admitted to a channel that every Asset's messages share. Until
  this is designed, anything that can send on that channel can claim to be any
  Asset the gateway carries.
- Whether an Asset behind a gateway is registered in Core, how a gateway is
  bound to the Assets it carries, how a gateway reports a radio Asset that its
  Fieldlink refused for different definitions, and the Fieldlink docs.
  [Gateway](../../gateway/README.md) owns that design.
- Catch-up reports: how retained reports fill history without delaying live
  events. This is low priority. How an Asset treats low-priority data depends on
  the Asset.
- Records this page names that Protocol does not define yet
  ([Protocol open questions](../../protocol/docs/open-questions.md)).
- The rest of the Entities API: `GET /entities`, `/entities/observations`,
  `/entities/tracks`, and `/entities/geofeatures`, as [sketched above](#entities).
  `/entities/assets` is already specified.
- The `/objects` and `/plugins` roots. They are part of the product, built with
  the rest ([pillars](pillars.md)), and their API is designed next.
