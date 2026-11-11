# Core API

The Command Interface, Assets on IP, gateways, and Plugins use this API to talk to Core
from outside its inner wall. This design is selected but not implemented.
Record shapes belong to [Protocol](../../protocol/README.md); this page names them and never redefines
their fields. The [walled city](../../atlas/design-decisions.md#a-walled-city)
explains why the API is the only way in.

## Basics

- HTTPS and JSON. Event bodies are Protocol records. Operator request bodies
  are Protocol's [request definitions](../../protocol/README.md#records); Core
  stamps the record fields, such as `time`, `task_id`, and `requested_by`.
- **Accepted is not done.** A request that Core passes to an Asset returns `202`
  with the request's `event_id`. Task states and setting values change only from
  the Asset's reports.
- **Compatibility.** Every request carries `Atlas-Definitions: <hash>`, the hash
  of the Protocol definitions the caller uses. Core refuses a missing or different
  hash with `409 definitions_mismatch`. `GET /about` needs no credential and
  returns `core_version`, `protocol_version`, `definitions_hash`, and `run_id`. The event
  stream takes the hash as `?definitions=`, because browsers cannot set headers on it.
  An Asset, gateway, or Plugin sends its key and hash on `GET /about` too. When
  that hash differs, Core adds a `definitions.refused` event, so operators see
  why it is missing.
- **Retries are safe.** Every request that changes state carries an
  `Idempotency-Key` of up to 64 characters. Core keeps each key's non-secret
  response for the run. A repeat returns that response and changes nothing; the
  same key with a different body returns `409`. Credential issuance and login
  return secrets only in the first response. Their retained response is a
  non-secret acknowledgment, as [credentials](#callers-and-credentials) defines.
- **Runs.** A run lasts from one start of Core to the next stop, and
  [Reset](reset.md) clears it. Every read, history page, and event stream covers
  only the current run. After a Reset, Core holds no history of the earlier run;
  it lives only in that run's Reset ZIP. `event_id` keeps rising across runs, so
  an old cursor never matches a new event. Other IDs, such as `task_id`,
  `track_id`, `geofeature_id`, and `object_id`, start again each run, so the
  same ID can name a different item in the next run.
- **A new run discards the old one.** A caller that finds a new `run_id` on
  `GET /about` throws away everything it held from the earlier run: its copy of
  the picture and history, its cursors, its links, and the operator's choices
  in their own view, such as hidden Tracks. It then starts again from a fresh
  read. A link or saved reference to an item names its run. When that run has
  ended, the caller never looks the item up in Core, because the same ID may now
  name something else. It says the item belonged to an ended run, whose record
  is in its Reset ZIP. Sessions end with the run, so everyone signs in again.
- **Errors** are a status and `{"error": "<code>", "explanation": "<text>"}`.

| Status | Meaning |
| --- | --- |
| `400 invalid` | The body fails Protocol's validator; `explanation` lists the paths |
| `401` | No valid session or key |
| `403` | The caller may not do this, such as an Asset reading another Asset |
| `404` | No such Asset, Task, account, Track, geo feature, Plugin, Plugin call, or Object |
| `409` | Refused: Asset or Plugin offline, queue full, command, setting, or action not supported, unknown Task, call already answered or ended, an imagery change other than its name, an Object imagery still shows, or definitions mismatch |
| `413 too_large` | The file is larger than `max_object_bytes` ([configuration](../config.md)) |
| `507 storage_full` | Core could not store the change, so it accepted nothing ([storage](storage.md#memory-and-full-disks)) |

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
| `/objects` | Files Core holds ([Objects](#objects)) |
| `/plugins` | Plugin descriptions, contact, calls, and answers ([Plugins](#plugins)) |
| `/administration` | Accounts, sessions, keys, and provisioning |

## Callers and credentials

| Caller | Credential | Event stream shows |
| --- | --- | --- |
| Account (admin or operator) | Session cookie from `POST /administration/login` | Everything |
| Asset on IP | Bearer Asset key | Requests for the Asset it registered, and the places its unfinished Tasks name |
| Gateway | Bearer key | Requests for the Assets it carries, and the places their unfinished Tasks name |
| Plugin | Bearer key | Calls addressed to it |

- Accounts log in with `operator_id` and a password. Core stores password hashes
  (scrypt). The session cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`, and
  Core accepts state changes only as JSON, except a file upload to
  [Objects](#objects), so other sites cannot send them.
- Asset, gateway, and Plugin keys are 16 random bytes as 22 characters of base64url. Core
  stores only their hashes and shows a key once, when an admin creates or replaces it.
  Keys belong to no run and carry across runs as configuration. An Asset key
  names no Asset: an Asset on IP uses it to [register](#asset-and-gateway-calls)
  each run, and Core assigns its `asset_id` then. A key belongs to at most one
  Asset at a time.
- A successful issuance retry with the same idempotency key returns an
  acknowledgment identifying the Asset key, gateway, or Plugin and confirming issuance. It
  returns no bearer key and creates or rotates nothing. Core never retains the
  secret response body in its retry cache, event log, or diagnostic logs.
- If the first issuance response is lost, the key cannot be recovered. The admin
  uses the returned ID to replace the Asset key, gateway key, or Plugin key with a new
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
- A radio Asset holds no Core key and never calls this API. It authenticates to
  its gateway through its Fieldlink, never to Core
  ([Gateway](../../gateway/README.md#what-every-fieldlink-provides)). Core holds
  nothing about the radio itself, only its Asset.

## The event log and live stream

Core adds one event for every accepted request, stored report, and Fusion
change to a Track, in the same
transaction as the change it records ([storage](storage.md)). Each event is
`{event_id, time, kind, record}`: a rising integer, Core's receive time in
milliseconds, one of the kinds below, and its record. Geo feature events also
carry `requested_by`, because their record names no author. A report event that
Core [marks](#asset-and-gateway-calls) as ahead of its clock carries
`clock_ahead: true`.

| Kind | Added when | Record |
| --- | --- | --- |
| `asset.provisioned`, `asset.removed` | An Asset [registers](#asset-and-gateway-calls), a gateway registers a radio Asset, or an admin removes an Asset | `provisioning` |
| `gateway.provisioned`, `gateway.removed` | An admin adds or removes a gateway | `provisioning` |
| `asset.carried` | A radio Asset moves to another gateway during the run, or its gateway is removed | `carrier`: `asset_id`, and `gateway_id` unless no gateway carries it |
| `plugin.provisioned`, `plugin.removed` | An admin adds or removes a Plugin | `provisioning` |
| `plugin.described` | A Plugin sends its description | `plugin.description` |
| `plugin.contact` | Core's view of a Plugin's contact changes | `contact` |
| `plugin.called` | An operator calls a Plugin action | `plugin.call` |
| `plugin.result`, `plugin.failed` | A Plugin answers a call | `plugin.result` or `plugin.failure` |
| `plugin.dropped` | Core ends a call the Plugin did not answer before it went offline or was removed | `drop`: `plugin_id`, `request_id` |
| `object.stored` | An operator or a Plugin stores a file | `object` |
| `object.changed` | An operator attaches an Object to a geo feature, moves it, or detaches it | `object` |
| `object.deleted` | An operator deletes an Object | `deletion`: `object_id`, `requested_by` |
| `asset.described` | The Asset sends its description | Its description record |
| `asset.contact` | Core's view of the Asset's contact changes | `contact` |
| `gateway.contact` | Core's view of the gateway's contact changes | `contact` |
| `definitions.refused` | An Asset on IP, gateway, radio, or Plugin connects with a different definitions hash | `refusal`: its `asset_id`, `gateway_id`, or `plugin_id`, and its `definitions_hash`. For a radio: the `gateway_id`, `radio: true`, and the radio's hash |
| `tasks.requested` | An operator sends Tasks | Every Task body in the request, in `task_id` order |
| `task.dropped` | Core discards a Task the Asset never confirmed it holds | `drop`: `asset_id`, `task_id` |
| `request.dropped` | Core stops delivering a request the Asset did not answer before it went offline | `drop`: `asset_id`, `request_id` |
| `settings.requested` | An operator changes settings | `asset_id`, `settings`, `requested_by` |
| `cancel.requested` | An operator cancels a Task | `asset_id`, `task_id`, `requested_by` |
| `report.<name>` | Core stores an Asset report, including `report.observation` | The report record |
| `track.updated` | Fusion creates or changes a Track | `track` |
| `track.removed` | Fusion removes a Track | The `track` as it last stood |
| `geofeature.created`, `geofeature.replaced` | A caller creates or replaces a geo feature | `geofeature`, and the event carries `requested_by` |
| `geofeature.deleted` | A caller deletes a geo feature | The `geofeature` as it last stood, and the event carries `requested_by` |

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
| `POST /tasks/{asset_id}` | `requests.tasks`: one or more Tasks in order, each one command kind and its fields, or a `settings` change; optional `now`, with one Task | `202 {task_ids, event_id}` |
| `PATCH /entities/assets/{asset_id}/settings` | `requests.settings`: `settings`, as end states | `202 {event_id}` |
| `POST /tasks/{asset_id}/{task_id}/cancel` | Nothing | `202 {event_id}` |

- Core validates the body, checks that the Asset is online and that its
  description lists every command and setting in it, and accepts or refuses the
  request whole. An unlisted command or setting is refused with `409`. Core
  refuses commands to an offline Asset and holds nothing.
- **At most 64 Tasks may be outstanding per Asset.** Outstanding work includes
  every accepted Task still crossing the link, held unstarted, or active,
  including work held while paused. Core counts a Task until its final Asset
  report is stored. Dropping an unanswered request alone does not free capacity,
  because it may have reached the Asset. A queue report alone does not prove
  that a missing Task has ended. When the Asset returns, Core cancels each
  dropped Task that the Asset reports neither holding, nor running, nor ended.
  Those places free when those final reports are stored.
  The 64 cap applies to ordinary requests: work that can sit in the unstarted
  queue. Core checks the total and reserves capacity for the whole request
  atomically with acceptance, so concurrent ordinary requests cannot exceed 64.
  If acceptance would exceed 64, Core refuses the whole request with
  `409 queue_full`, without assigning Task IDs or adding accepted work.
  A `now` request is one Task that runs immediately and cancels every lower
  `task_id`, so it is never a 65th held unstarted Task. Core admits `now` even
  when 64 Tasks are already outstanding. Outstanding work may briefly exceed 64
  until the cancelled Tasks' final reports are stored. That overage does not
  refuse another `now`. Ordinary requests are still refused until the total
  falls back to 64. A retry consumes no extra capacity. After capacity is
  freed, a refused caller uses a new idempotency key for a new admission
  attempt.
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
  accepts it whatever its `clear_count`. Core admits `now` even at the 64 cap,
  as the capacity rule above.
- The Asset answers a Task request with a queue report that names the request
  and lists the Tasks the Asset holds.
- **Unanswered requests end when the Asset goes offline.** Core stops delivering
  every request the Asset has not answered: Tasks, settings changes, and cancels.
  Core adds `request.dropped` for each, and `task.dropped` for each Task the
  Asset never reported holding. The Asset's stream skips dropped requests when it
  returns, so no old request runs late. Core then cancels each dropped Task that
  the returning Asset reports neither holding, nor running, nor ended, so a
  dropped `task_id` never blocks the Tasks after it. Those cancelled Tasks
  still hold their capacity places until those final reports are stored.
  An operator who still wants the work sends it again.
- A dropped request may have reached the Asset before contact ended. The Asset's
  later reports say what it did. `request.dropped` does not prove the request
  never arrived.
- Cancel names one Task. The Asset cancels it whether it is queued or running.
  To change the order of Tasks already sent, cancel them and send new ones.

## Reads

| Request | Returns |
| --- | --- |
| `GET /entities/assets` | Every Asset: description, contact, the gateway carrying it, latest reports except `report.observation` (see [Observations](#observations)), each setting's latest value, and each declared subsystem's latest condition; and each gateway's contact |
| `GET /entities/assets/{asset_id}` | One Asset, the same way |
| `GET /tasks/{asset_id}` | Task bodies, latest states, and the Tasks the Asset reports holding |
| `GET /history?asset_id&report&since&until&cursor&limit` | Stored reports ordered by report time, then `event_id`; at most 1000 per page, with `next_cursor` |
| `GET /history/tracks?track_id&since&until&cursor&limit` | Stored `track.updated` and `track.removed` events, ordered by the Track's `time`, then `event_id`, paged the same way |
| `GET /history/geofeatures?geofeature_id&since&until&cursor&limit` | Stored geo feature events in `event_id` order, paged the same way |

Track and geo feature history is what review replays: a Track's past path, and
each geo feature as it stood at the time being replayed, including ones deleted
later. A Track's past path follows its sighting times, as an Asset's trail
follows report times, so `since` and `until` compare with the Track's `time`;
a `track.removed` event sorts at the event's own `time`. For geo features they
compare with the event's `time`. Only
accounts and Plugins read them. The rest of the picture is under
[Entities](#entities).

## Asset and gateway calls

Every Asset registers anew each run and Core assigns its `asset_id`; nothing
picks its own. An Asset on IP starts in this order, and on reconnect within the
run repeats it from step 2:

1. `GET /about` with its Asset key, and compare the definitions hash.
2. On start, `POST /entities/assets` with its description record. Core assigns
   the next `asset_id`, adds `asset.provisioned`, and answers `201 {asset_id}`.
   The Asset uses that ID for the rest of the run. Registering again with the
   same key in the run returns the same `asset_id`, unless an admin removed that
   Asset; then it becomes a new Asset with a new ID. A key registers at most one
   Asset at a time. On reconnect, `PUT /entities/assets/{asset_id}/description`
   instead.
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
key, once it has [registered the radio](#radio-assets). It also sends
`PUT /entities/assets/{asset_id}/contact` with a `contact` record whenever its
Fieldlink's view of that Asset changes. Only a gateway may send it, for an Asset
it carries, or one it [takes over](#radio-assets), named by the path; any other
caller gets `403`. Core
authenticates the gateway and trusts it for which Asset sent what. Each Asset
authenticates to the gateway, not to Core.

A gateway runs on its own computer, apart from Core. Its link to Core is IP with
broadband speed, so the gateway follows the event stream for every Asset it
carries, keeps their current state, and sends over the radio only what each
Asset does not already have. Tasks may cross the radio one at a time and in any
order, because the Asset orders them by `task_id`.

### Radio Assets

[Gateway](../../gateway/README.md#how-a-radio-asset-joins-and-leaves) owns the
results; these are the calls behind them.

A gateway is an IP bridge. It matches each radio to its Asset on its own side
and speaks to Core only by `asset_id`; Core keeps nothing about the radio
itself.

- When the gateway hears a radio that has no `asset_id` in this run, it sends
  `POST /entities/assets/radios` with `requests.radio`: the radio's
  definitions hash. Core assigns the next `asset_id`, adds `asset.provisioned`
  with the gateway as `requested_by`, and answers `201 {asset_id}`. The gateway
  carries that Asset, keeps which radio has which ID, and tells the radio its
  ID through the Fieldlink.
- Core refuses a different definitions hash with `409 definitions_mismatch` and
  adds `definitions.refused`. The refusal adds no Asset.
- **A gateway swap keeps the Assets.** A radio that already has an `asset_id`
  in this run tells it to the gateway it now reaches, through the Fieldlink. If
  that Asset is a radio Asset of this run, not removed, and its carrier is
  offline, removed, or none, the new gateway takes it over by sending
  `PUT /entities/assets/{asset_id}/contact`. Core records the new carrier and
  adds `asset.carried`. The Asset keeps its ID and its unfinished Tasks. This
  is not a new run: new IDs come only with the next run.
- When an admin removes a radio Asset, its ID ends. If the radio is heard
  again, its gateway registers it as a new Asset with a new ID.
- A gateway acts only for the Assets it carries. Its calls for any other Asset
  get `403`.
- Removing a gateway leaves its radio Assets in the picture, offline, and
  carried by no gateway, until they reach another gateway. Replacing its key
  changes nothing for them.

## Contact

- **Core's view.** An Asset is online while Core has heard from it within
  `offline_after_s` ([configuration](../config.md)). Core hears from an Asset on
  IP each time the Asset calls the API. Through a gateway, Core takes the
  gateway's latest `contact` record for the Asset as its view, and marks every
  Asset the gateway carries offline once the gateway itself has been quiet for
  `offline_after_s`. An open event stream is not evidence of contact. An
  Asset with nothing to report posts an empty report batch often enough to stay
  online. Core adds an `asset.contact` event when its view changes.
- **A gateway's contact.** A gateway is online while Core has heard from it
  within `offline_after_s`. Every request it makes with its key counts, but an
  open event stream does not; with nothing else to send, it calls `GET /about`
  with its key. Core adds a
  `gateway.contact` event when its view changes.
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
| `POST /administration/asset-keys`, `DELETE /administration/asset-keys/{key_id}` | Create or remove an Asset key for an Asset on IP; creating returns its `key_id` and key once |
| `POST /administration/asset-keys/{key_id}/key` | Replace an Asset key; returns the new key once |
| `DELETE /administration/assets/{asset_id}` | Remove an Asset from the run. It may come back by registering again, as a new Asset |
| `POST /administration/gateways`, `DELETE /administration/gateways/{gateway_id}` | Provision or remove a gateway; provisioning returns its `gateway_id` and key once |
| `POST /administration/gateways/{gateway_id}/key` | Replace a gateway key; returns the new key once |
| `POST /administration/plugins`, `DELETE /administration/plugins/{plugin_id}` | Provision or remove a Plugin; provisioning returns its `plugin_id` and key once |
| `POST /administration/plugins/{plugin_id}/key` | Replace a Plugin key; returns the new key once |

### Credential retry scenarios

These are requirements to test when Core is built; no credential runtime exists yet.

- Create an Asset key, or provision a gateway or Plugin, and lose the first response. Retry with the same
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
| `/entities/assets` | The actor surface, already specified above: registration, description, contact, settings, and reports. Observations an Asset reports arrive here as reports. Keys are under `/administration`. Tasks are under `/tasks`. |
| `/entities/observations` | Evidence in the picture, separate from Tracks. Callers read Observations here. They do not create them. Assets write them only as reports. |
| `/entities/tracks` | Conclusions Fusion produced. Callers read Tracks here. They do not create them. Fusion writes Tracks through the Entities pillar's functions, never this API. |
| `/entities/geofeatures` | Places operators create, edit, and delete, and Plugins create. A Task may name a place by `geofeature_id`, as a live reference, and the Asset reads that place's current shape ([Geo features](#geo-features)). |

Objects are not Entities.

### Read the picture

| Request | Returns |
| --- | --- |
| `GET /entities` | `{as_of, assets, observations, tracks, geofeatures}`: one consistent cut of the whole picture |
| `GET /entities/observations` | `{as_of, items}`: every Observation |
| `GET /entities/tracks` | `{as_of, items}`: every Track |
| `GET /entities/tracks/{track_id}` | `{as_of, item}`: one Track |
| `GET /entities/geofeatures` | `{as_of, items}`: every geo feature |
| `GET /entities/geofeatures/{geofeature_id}` | `{as_of, item}`: one geo feature |

- **A read and an event look the same.** Each Observation, Track, and geo feature
  item is exactly the Protocol record the event stream carries for it:
  `report.observation`, `track`, or `geofeature`. A reader applies a read and a
  later event the same way. Asset entries keep the shape of
  [`GET /entities/assets`](#reads).
- **No filters or paging.** At Atlas's [scale](../../atlas/scale.md) the whole
  picture stays small, so every read returns all of it.
- **Accounts and Plugins read the picture.** A Plugin uses this same API with
  its Plugin key, through the [Plugin interface](#plugins).
  Assets and gateways get `403` on these paths and keep only their own
  `/entities/assets/{asset_id}` calls, plus the geo features their Tasks
  [name](#geo-features).
- **Nothing expires during a run.** Observations stay in the picture for the
  whole run, and a Track stays until Fusion removes it. Core adds no stale
  status. Every record keeps its `time`, and readers show its age. A status
  that changed only because time passed would have no event, so a reader could
  not follow it from a snapshot.

### Observations

An Observation is the latest `report.observation` for one `asset_id` and
`observation_id`, ordered by report time and then `event_id`, as settings are.
A report marked `clock_ahead` never becomes the latest. The Asset chooses
`observation_id` and posts its reports through
[`POST /entities/assets/{asset_id}/reports`](#asset-and-gateway-calls). Each
report is whole, so the latest report is the whole Observation. Earlier reports
are [history](#reads). An Observation changes only when its Asset reports.

### Tracks

Only [Fusion](fusion.md) creates, changes, or removes a Track, through the
Entities pillar's functions. Core assigns its `track_id` and never reuses it in
the run. No caller writes, moves, renames, or deletes a Track; an operator who
disagrees with one hides it in their own view. Each change adds `track.updated`,
and a removal adds `track.removed`.

### Geo features

| Request | Body | Result |
| --- | --- | --- |
| `POST /entities/geofeatures` | `requests.geofeature` | `200 {geofeature, event_id}` |
| `PUT /entities/geofeatures/{geofeature_id}` | `requests.geofeature` | `200 {geofeature, event_id}` |
| `DELETE /entities/geofeatures/{geofeature_id}` | Nothing | `200 {event_id}` |

- These are local edits. Nothing goes to an Asset, so Core answers `200` with
  the stored result, not `202`. The [retry rules](#basics) apply as to every
  change.
- `POST` creates a geo feature, and Core assigns its `geofeature_id`. `PUT`
  replaces one whole, so a name left out is cleared and its shape may change
  kind, except imagery. `DELETE` removes it from the picture. Core never reuses a
  `geofeature_id` in the run, and a deleted one returns `404`.
- Any admin or operator may create, replace, or delete any geo feature,
  including one a Plugin made. A Plugin may only create geo features, with its
  key ([Plugins](#plugins)). Assets and gateways get `403`.
- The event names who asked with `requested_by`, because the geo feature record
  names no author. A geo feature a Plugin creates names the Plugin.
- **A Task names a place live.** `move_to` and `land` may name a point geo
  feature by `geofeature_id` instead of a position. Core checks that it exists
  and is a point when it accepts the Task, refuses a `geofeature_id` that does
  not exist with `404`, and never copies its shape into the Task. The Asset
  learns of the place this way:
  - An Asset, or the gateway carrying it, may
    `GET /entities/geofeatures/{geofeature_id}` for a geo feature that one of the
    Asset's unfinished Tasks names. Any other geo feature gets `403`.
  - The Asset's event stream carries that geo feature's current record, and
    each later `geofeature.replaced` or `geofeature.deleted`, while an
    unfinished Task names it, so an edit reaches it as a new Task does. The
    gateway sends over the radio only what the Asset lacks.
  - Geo features are not otherwise sent to Assets, and Assets and gateways read
    nothing else of the picture. Failsafe boundaries and failsafe responses
    never name a geo feature.
- **Edits are never blocked.** An operator may replace or delete a place while
  unfinished Tasks name it. Core does not refuse the change and does not
  cancel any Task. The Asset decides how to carry on: it may keep its original
  plan or follow the new shape, and a Task whose place was deleted runs or
  fails as the Asset decides, reporting what it did
  ([Asset behavior](../../asset/docs/README.md#carry-out-work-and-report-its-result)).
- **Imagery shows a GeoTIFF on the map.** An imagery geo feature names one
  stored Object, and the map draws that file where the file says it belongs.
  Core refuses an Object that is not a GeoTIFF with `409`, and an `object_id`
  that does not exist with `404`. A `PUT` on imagery may change only its name;
  any other change, or turning another kind into imagery, is refused with
  `409`. To correct the image, add a new imagery geo feature. Deleting imagery
  leaves its Object.

## Objects

An Object is a file Core holds, with an `object` record that says what it is:
`object_id`, `name`, `content_type`, `size_bytes`, and an optional
`geofeature_id`. Operators and Plugins store Objects. Core never sends them to
Assets or gateways.

| Request | Who | Result |
| --- | --- | --- |
| `POST /objects?name=<name>&geofeature_id=<id>` | Account or Plugin | Stores the file; `201 {object_id, event_id}` |
| `GET /objects?geofeature_id=<id>` | Account or Plugin | Every Object record, or those attached to one geo feature, with `as_of` |
| `GET /objects/{object_id}` | Account or Plugin | One Object record |
| `GET /objects/{object_id}/file` | Account or Plugin | The file, with its `content_type` |
| `PATCH /objects/{object_id}` | Account | `{"geofeature_id": <id or null>}` attaches, moves, or detaches it; `200 {event_id}` |
| `DELETE /objects/{object_id}` | Account | Deletes the Object and its file; `200 {event_id}` |

- **An upload is the file itself.** The body is the file's bytes and its
  `Content-Type` header is the file's type. `name` is required and
  `geofeature_id` is optional. It is the one state change whose body is not
  JSON. The required `Atlas-Definitions` header still keeps other sites from
  sending it. Like every change, it carries an `Idempotency-Key`; a repeat
  stores nothing new.
- **Core assigns `object_id`** and never reuses it in a run, even after a delete.
- **Stored whole or not at all.** Core writes the file, then adds the Object's
  row and its `object.stored` event in one transaction. There is no half-stored
  Object. A file larger than `max_object_bytes` ([configuration](../config.md))
  is refused with `413 too_large`, and a `geofeature_id` that does not exist with
  `404`.
- **The file never changes.** A different file is a new Object. Only which geo
  feature it belongs to can change, and only an operator changes it. The change
  names the end state, so applying it twice changes nothing.
- **One geo feature at most.** An Object names at most one geo feature, and the
  link is kept only on the Object. A geo feature's Objects are those that name it.
  Deleting a geo feature leaves its Objects, which keep its ID as a record. This
  relies on a `geofeature_id` never being reused in a run, which the
  [Entities](#entities) design must keep.
- **Delete removes the file.** The `object.stored` and `object.deleted` events
  stay in history for the rest of the run, and then in its Reset ZIP, so the
  record of the upload and of who deleted it remains.
  Only an operator deletes an Object. Core refuses to delete an Object that an
  imagery geo feature still shows with `409`; the operator deletes the imagery
  first.
- **Who stored it** is `requested_by` in the Object record: the account that
  uploaded it or the Plugin that stored it. Core stamps it, as for Tasks.
- **Objects belong to their run.** When the run ends, their files go into
  Core's [Reset ZIP](reset.md#cores-reset-zip) and are cleared from Core. The
  next run starts with none.

## Plugins

A [Plugin](../../atlas/plugins.md) is a program in the second ring that offers
actions. It runs on its own, in its own container if it needs one, and connects
out to Core like a gateway: it holds a key, follows its own event stream for
calls addressed to it, and posts its answers. Core never needs to know where a
Plugin runs.

The Plugin interface is the set of Core API calls a Plugin's key may use. There
is no second protocol and nothing is repeated under `/plugins`.

| A Plugin may | With |
| --- | --- |
| Describe itself, stay in contact, follow its calls, and answer them | `/about`, `/events`, and `/plugins/{plugin_id}/...` below |
| Read the shared picture | `GET` under `/entities` |
| Create geo features | `POST /entities/geofeatures` |
| Store and read Objects | `POST /objects` and `GET` under `/objects` |

A Plugin may not send Tasks, change settings, call another Plugin, change or
delete what anyone has stored, or use `/administration`. Assets and gateways may
not call Plugins yet.

### A Plugin starts

1. `GET /about` with its key, and compare the definitions hash.
2. `PUT /plugins/{plugin_id}/description` with its `plugin.description`
   record: its name and the actions it offers, each with a label, optional
   help text, its inputs, and its display choices: whether it appears in the
   right-click menu, and whether its listed places show on the map by
   default. The Plugin names and describes its own actions from Protocol's
   common input kinds, so a new action needs no Protocol change. Core checks
   the description with Protocol's validator and refuses an invalid one with
   `400 invalid`.
3. Open `/events?after=<last handled event_id>`. Its stream shows only
   `plugin.called` events addressed to it.

A Plugin is online while Core has heard from it within `offline_after_s`
([configuration](../config.md)). Every call it makes with its key counts; an
open event stream does not. A Plugin calls `GET /about` often enough to stay
online, including while it works on a long call.
Core adds `plugin.contact` when its view changes, so operators see which Plugins
they can use.

### Operators call actions

| Request | Body | Result |
| --- | --- | --- |
| `POST /plugins/{plugin_id}/actions/{action}` | `requests.plugin_call`: a value for each of the action's inputs | `202 {event_id}` |
| `GET /plugins` | | Every Plugin: description, contact, and its unanswered calls, with `as_of` |
| `GET /plugins/{plugin_id}/calls?cursor&limit` | | Its calls with their answers, newest first; at most 1000 per page, with `next_cursor` |
| `GET /plugins/{plugin_id}/calls/{event_id}` | | One call and its answer, if any |

- Core validates the inputs with Protocol's validator, checks that the Plugin
  is online and that its description lists the action, and checks the values
  against that action: each names one of its inputs with the same kind, a
  choice is one the Plugin listed, and every input not marked optional is
  given once. A value that does not match is refused with `400 invalid`. Core
  then accepts the call or refuses it. A Plugin that
  is not online is refused at once with `409`. Nothing waits for it to return.
- An accepted call is one `plugin.called` event, carrying the `plugin.call`
  record Core stamps from the body. Its `event_id` names the call
  from then on, as a request's `event_id` does for an Asset. There is no other
  call ID.
- Every account sees every call and its answer, because Atlas keeps one shared
  picture and one history.
- There is no stop for a call. An operator who no longer wants the answer
  ignores it. A call is never repeated by itself; an operator who wants fresh
  data calls again.

### Plugins answer

`POST /plugins/{plugin_id}/answers` takes one answer record, which names its
call with `request_id`, the call's `event_id`. Every action answers the same
way:

- **A result** (`plugin.result`): places it lists without storing them, of
  any kind (point, line, area, or imagery), short facts, and the IDs of the geo features and Objects it created, in any mix.
  An empty result means it found nothing. Core stores it as `plugin.result`.
- **A failure** (`plugin.failure`): an `explanation`, and the IDs of anything
  it had already created. Core stores it as `plugin.failed`.
- **No partial lists.** Each list in an answer holds at most 1000 items. A
  Plugin with more fails with an explanation, such as "Area too large", so a
  partial list is never mistaken for the whole answer.

- Core checks the answer with Protocol's validator. An invalid answer is
  refused with `400 invalid`, and the call stays unanswered.
- A call has one answer. A second answer, or an answer to a call that was
  dropped, is refused with `409`. A retry with the same `Idempotency-Key`
  returns the first response.
- A Plugin may run several calls at once and answer them in any order.

### A Plugin goes offline or is removed

When a Plugin goes offline or an admin removes it, Core ends every call it has
not answered and adds `plugin.dropped` for each. Its stream skips dropped calls
when it returns, so no old call runs late. Geo features and Objects it stored
before it stopped stay, and still name the Plugin in `requested_by`. The call is
marked not finished, and an operator who still wants it calls again.

## Not defined yet

- Catch-up reports: how retained reports fill history without delaying live
  events. This is low priority. How an Asset treats low-priority data depends on
  the Asset.
- A read of a deleted Object: who deleted it and when, so a link to it can say
  what happened ([Command Interface](../../command-interface/docs/plugins-and-objects.md#objects)).
