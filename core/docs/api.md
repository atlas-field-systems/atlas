# Core API

The Command Interface, Assets on IP, gateways, and Plugins use this API to talk to Core
from outside its inner wall. This design is selected but not implemented.
Record shapes belong to [Protocol](../../protocol/README.md); this page names them and never redefines
their fields. The [walled city](../../atlas/design-decisions.md#a-walled-city)
explains why the API is the only way in.

## Basics

Core serves HTTPS when both TLS files are configured. Without them it serves
plain HTTP only on loopback. [Configuration](../config.md) owns TLS setup.

A keyed `GET /about` with another definitions hash records at most one
`definitions.refused` per registered Asset, gateway, or Plugin and hash per run. It still counts as contact.
For an Asset key that has not registered, Core instead records its `key_id` and
the differing hash on the console and in diagnostics, at most once per key and
hash per run. It adds no event because the key has no Asset.
Accounts may call every operator route.

- HTTPS and JSON. Event bodies are Protocol records. Operator request bodies
  are Protocol's [request definitions](../../protocol/README.md#records); Core
  stamps the record fields, such as `time`, `task_id`, and `requested_by`.
- **Accepted is not done.** A request that Core passes to an Asset returns `202`
  with the request's `event_id`. Task states and setting values change only from
  the Asset's reports.
- **Compatibility.** Every request carries `Atlas-Definitions: <hash>`, the hash
  of the Protocol definitions the caller uses, made by Protocol's
  [hash recipe](../../protocol/docs/decisions.md#definitions-hash). Core refuses
  a missing or different hash with `409 definitions_mismatch`. `GET /about`
  needs no credential and
  returns `core_version`, `protocol_version`, `definitions_hash`, and `run_id`. The event
  stream takes the hash as `?definitions=`, because browsers cannot set headers on it.
  An Asset, gateway, or Plugin sends its key and hash on `GET /about` too. When
  that hash differs, Core records the mismatch as described above.
- **Retries are safe.** Every request that changes state carries an
  `Idempotency-Key` of up to 64 characters. Core keeps each key's non-secret
  response for the run when its transaction changed something. A refusal that changed nothing is not kept. A repeat returns that response and changes nothing; the
  same key with a different body returns `409`. Credential issuance and login
  return secrets only in the first response. Their retained response is a
  non-secret acknowledgment, as [credentials](#callers-and-credentials) defines.
- **Runs.** Every read, history page, and event stream covers only the current
  run. [Runs and identity](../../atlas/runs-and-identity.md) owns what a run is,
  what carries over, and which IDs start again. `GET /about` names the run with
  `run_id`.
- **A new run discards the old one.** A caller that finds a new `run_id` on
  `GET /about` throws away everything it held from the earlier run, including
  its cursors and links, and starts again from a fresh read. A link names its
  run. For an ended run, the caller never looks the item up in Core, because the
  same ID may now name something else; it says the item's record is in that
  run's Reset ZIP.
- **Errors** are a status and `{"error": "<code>", "explanation": "<text>"}`.

| Status | Meaning |
| --- | --- |
| `400 invalid` | The body fails Protocol's validator; `explanation` lists the paths |
| `401 unauthenticated` | No valid session or key |
| `403 forbidden` | The caller may not do this, such as an Asset reading another Asset |
| `404 not_found` | No such Asset, Task, account, Track, geo feature, Plugin, Plugin call, or Object |
| `405 method_not_allowed` | The path exists but does not accept this method |
| `409 asset_ids_exhausted`, `task_ids_exhausted` | No ID remains in the applicable sequence |
| `409 definitions_mismatch` | Missing or different definitions hash |
| `409 asset_offline`, `plugin_offline` | Recipient is offline |
| `409 no_critical_battery_rule` | Flying Asset has no critical battery rule |
| `409 queue_full` | The request exceeds the reported queue cap |
| `409 not_supported` | Command, setting, camera, or action is not declared |
| `409 task_ended`, `call_settled` | Task ended or Plugin call was already answered or dropped |
| `409 not_a_point`, `not_geotiff` | Place or file cannot serve the requested use |
| `409 imagery_fixed`, `object_shown` | Imagery change is forbidden or imagery still shows the Object |
| `409 id_taken`, `idempotency_conflict` | Identity is in use or retry key names another body |
| `501 not_implemented` | The route's pillar is not built yet |
| `503 stopping` | Core is stopping |
| `410 deleted` | The Object was deleted in this run; the body adds its `deletion` record, which says who deleted it and when |
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
| Asset on IP | Bearer Asset key | Requests for the Asset it registered, and drops of its Tasks |
| Gateway | Bearer key | Requests for the Assets it carries, and drops of their Tasks |
| Plugin | Bearer key | Calls addressed to it |

- Accounts log in with `operator_id` and a password. Core stores password hashes
  (scrypt). The session cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`, and
  Core accepts state changes only as JSON, except a file upload to
  [Objects](#objects), so other sites cannot send them.
- Asset, gateway, and Plugin keys are 16 random bytes as 22 characters of base64url. Core
  stores only their hashes and shows a key once, when an admin creates or replaces it.
  Keys belong to no run. An Asset key names no Asset: an Asset on IP uses it to
  [register](#asset-and-gateway-calls).
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
- A radio Asset holds no Core key and never calls this API
  ([radio Assets](#radio-assets)).

## The event log and live stream

Core adds one event for every accepted domain request, stored report, and Fusion
change to a Track, in the same
transaction as the change it records ([storage](storage.md)). Each event is
`{event_id, time, kind, record}`: a rising integer, Core's receive time in
milliseconds, one of the kinds below, and its record. Geo feature events also
carry `requested_by`, because their record names no author. A report event that
Core [marks](#asset-and-gateway-calls) as ahead of its clock carries
`clock_ahead: true`.

| Kind | Added when | Record |
| --- | --- | --- |
| `asset.registered`, `asset.removed` | An Asset [registers](#asset-and-gateway-calls), a gateway registers a radio Asset, or an admin removes an Asset | `registration` |
| `gateway.provisioned`, `gateway.removed` | An admin adds or removes a gateway | `provisioning` |
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
| `tasks.updated` | An operator edits a place and chooses to update the unfinished Tasks that use it | For one Asset, every updated Task body, in `task_id` order |
| `task.dropped` | Core discards a Task the Asset never confirmed it holds, or one a restarted Asset [no longer holds](#operator-requests) | `drop`: `asset_id`, `task_id` |
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

Within a run, the next Task after 9999 is refused with `409 task_ids_exhausted`.
Cancel for an unknown Task is `404 not_found`; cancel for an ended Task is
`409 task_ended`. A cancel to an offline Asset is refused as other requests are.
A flying Asset without a critical battery rule is refused a Tasks request even
when it includes a settings Task. Send the rule as a settings change first.

| Request | Body | Result |
| --- | --- | --- |
| `POST /tasks/{asset_id}` | `requests.tasks`: one or more Tasks in order, each one command kind and its fields, or a `settings` change; optional `now`, with one Task | `202 {task_ids, event_id}` |
| `PATCH /entities/assets/{asset_id}/settings` | `requests.settings`: `settings`, as end states | `202 {event_id}` |
| `POST /tasks/{asset_id}/{task_id}/cancel` | Nothing | `202 {event_id}` |

- Core validates the body, checks that the Asset is online and that its
  description lists every command and setting in it, and accepts or refuses the
  request whole. An unlisted command or setting is refused with `409`. Core
  refuses commands to an offline Asset and holds nothing, Fail-safe included.
- **Capture names a declared camera.** Core refuses a `capture` Task with
  `409` when `camera_id` is not in the Asset's description.
  [Protocol Task kinds](../../protocol/definitions/records/task.json) define
  the accepted kinds, including Capture.
- **A flying Asset needs a critical battery rule.** An Asset whose description
  lists `takeoff` is a flying Asset. Core refuses Tasks to it with
  `409 no_critical_battery_rule` while its latest reported `failsafe_policy`
  has no rule with a critical battery condition, and refuses a settings change
  that would replace its policy with one that has none
  ([Failsafes](../../asset/docs/failsafes.md#no-rules-are-enabled-by-default)).
- **Fail-safe runs now.** A `failsafe` Task is sent alone with `now`; Core
  refuses it otherwise with `400 invalid`. The Asset treats it as if its
  failsafe had fired ([Failsafes](../../asset/docs/failsafes.md#an-operator-can-fire-the-failsafe)).
- **At most 64 ordinary Tasks per Asset.** Core counts the Tasks that the
  Asset's latest queue report lists. It refuses an ordinary request that would
  take that count over 64 with `409 queue_full`, whole, without assigning Task
  IDs. A `now` request is one Task that runs at once and cancels every lower
  `task_id`, so Core admits it even at 64. Core does not count Tasks still
  crossing the link, so two requests close together can overfill the queue: an
  Asset that already holds 64 unstarted Tasks reports each further ordinary
  Task `cancelled`, with a full queue as its explanation.
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
- **A failure clears the queue.** A failed Task
  [clears the Asset's queue](../../asset/docs/failsafes.md#a-failed-command-cancels-the-remaining-tasks).
  Tasks that arrive after the clear run normally; an operator cancels any that
  no longer make sense.
- With `now`, a request carries one Task. The Task runs at once, even while the
  Asset is paused, and cancels every Task with a lower `task_id`. Core admits
  it even at the 64 cap.
- The Asset answers a Task request with a queue report that names the request
  and lists the Tasks the Asset holds.
- **Unanswered requests end when the Asset goes offline.** Core stops delivering
  every request the Asset has not answered: Tasks, settings changes, and cancels.
  Core adds `request.dropped` for each, and `task.dropped` for each Task the
  Asset never reported holding. Operators see them as not done and send again
  whatever still matters. When the Asset returns, its stream skips the dropped
  requests but carries the `task.dropped` events. The Asset counts each dropped
  `task_id` as ended and never runs it, so no old request runs late and no
  dropped `task_id` blocks the Tasks after it.
- **A restarted app holds nothing.** An Asset that signs up again while
  already registered has started again and
  [dropped its queued Tasks](../../atlas/runs-and-identity.md#keys-and-registration).
  Core adds `task.dropped` for each of its Tasks with no final report. It also drops unanswered settings and cancel requests, and adds no new `asset.registered`. A drop
  claims no outcome: operators see the Task as not done and send again what
  still matters. Results the app had not reported before the restart are lost.
  The registration answer's `last_task_id` is the highest `task_id` Core has
  given the Asset in the run, or 0. The app counts every `task_id` up to it as
  ended, so no forgotten Task blocks new work.
- A dropped request may have reached the Asset before contact ended. The Asset's
  later reports say what it did. `request.dropped` does not prove the request
  never arrived.
- Cancel names one Task. The Asset cancels it whether it is queued or running.
  To change the order of Tasks already sent, cancel them and send new ones.

## Reads

Accounts read everything. Plugins read the picture and history. Assets read
only their own Asset entry; gateways read only the Assets they carry. Tasks
reads belong to accounts.

`GET /entities/assets` returns `{as_of, items, gateways}`. Each Asset entry
contains `asset_id`, `gateway_id` (or null), `description` (or null), `contact`,
`reports` (latest by report kind), `settings` (latest report per setting), and
`subsystems` (latest condition per declared subsystem). `GET /entities/assets/{asset_id}`
returns `{as_of, item}` with the same entry. `GET /tasks/{asset_id}` returns
`{as_of, items, held}`. Each Task entry has `task`, `state`, `state_time`, and optional `object_ids`;
`held` is the latest reported list of Task IDs.

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

A clock-ahead report still answers its request and moves Task state forward.
It never becomes latest, and a clock-ahead queue report does not count toward
the Task cap.

Core assigns each Asset's `asset_id` when it registers
([Runs and identity](../../atlas/runs-and-identity.md#ids)). An Asset on IP
starts in this order, and on reconnect within the run repeats it from step 3:

1. `GET /about` with its Asset key, and compare the definitions hash.
2. On start, `POST /entities/assets` with `requests.asset`: its description
   without `time` and `asset_id`. Core assigns the next `asset_id`, never one
   used before, stamps `time` and the ID to make the description record, adds
   `asset.registered` and `asset.described`, and answers
   `201 {asset_id, last_task_id}` ([restarts](#operator-requests)).
   The Asset uses that ID for the rest of the run. Registering again with the
   same key in the run returns the same `asset_id`, even for an app that
   restarted and forgot its ID, unless an admin removed that Asset; then it
   becomes a new Asset with a new ID. A key registers at most one Asset at a
   time. With no Asset ID left, Core refuses with `409 asset_ids_exhausted` and
   tells the admin ([Runs and identity](../../atlas/runs-and-identity.md#ids)).
   Only a start signs up: an app that started again registers, even if it
   remembers its ID, and a reconnect skips this step.
3. `POST /entities/assets/{asset_id}/reports` with its known settings, its queue if it has
   one, the report of its active Task, and any final Task reports Core has not
   yet acknowledged.
4. Open `/events?after=<last handled event_id>`. On first start, it follows from
   the latest event.

- `POST /entities/assets/{asset_id}/reports` takes `requests.reports` in batches of up to 1000 reports. An empty batch is accepted for contact. A `200`
  stores and acknowledges the whole batch. The Asset resends a batch with the same
  `Idempotency-Key` until it gets one. Retained reports catching up after a gap use
  the same call with their original times. The Asset sends its current state
  first, then retained reports oldest first, one batch at a time and only while
  no live report waits, so catching up never delays live events. History orders
  reports by their own times. Nothing marks history complete: a report the Asset
  never delivered stays in its [Reset ZIP](../../asset/docs/logging.md#export-the-assets-reset-zip).
- A report that answers a request names it with `request_id`, the request's
  `event_id`. Task reports name their `task_id`.
- The Asset keeps the Tasks of each `tasks.requested` and runs its Tasks in
  `task_id` order. It starts a Task only when every lower `task_id` has ended and
  every Task through the Task's `send_last` is held or has ended. A `task_id` the Asset has
  not received blocks the Tasks after it until it arrives, is cancelled, or is
  dropped.
- The Asset reports a Task `cancelled` without running it in three cases: a
  cancel for the Task arrived before the Task, a `now` Task with a higher
  `task_id` has run, or the Asset already holds 64 unstarted Tasks and `now` is
  not set.
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
it carries, named by the path; any other caller gets `403`. Core
authenticates the gateway and trusts it for which Asset sent what. Each Asset
authenticates to the gateway, not to Core.

A gateway runs on its own computer, apart from Core. Its link to Core is IP with
broadband speed, so the gateway follows the event stream for every Asset it
carries, keeps their current state, and sends over the radio only what each
Asset does not already have. Tasks may cross the radio one at a time and in any
order, because the Asset orders them by `task_id`.

### Radio Assets

When a gateway reconnects to Core, it sends contact for every Asset it carries,
even if its Fieldlink's view did not change.

[Runs and identity](../../atlas/runs-and-identity.md#radio-assets) owns the
results; these are the calls behind them. The gateway matches each radio to its
Asset on its own side and speaks to Core only by `asset_id`.

- When the gateway hears a radio that has no `asset_id` in this run, it sends
  `POST /entities/assets/radios` with `requests.radio`: the radio's
  definitions hash. Core assigns the next `asset_id`, adds `asset.registered`
  with the gateway as `requested_by`, and answers `201 {asset_id}`. The gateway
  carries that Asset, keeps which radio has which ID, and tells the radio its
  ID through the Fieldlink.
- Core refuses a different definitions hash with `409 definitions_mismatch` and
  adds `definitions.refused`. The refusal adds no Asset.
- **One gateway for the network.** The area's one gateway carries every radio
  Asset it registered, and no other gateway carries them. A radio whose app
  restarted mid-run identifies itself to that gateway through the Fieldlink and
  keeps its ID, but its work does not resume
  ([Runs and identity](../../atlas/runs-and-identity.md#keys-and-registration)).
  A radio Asset signs up through its gateway with
  `PUT /entities/assets/{asset_id}/description` and its description record:
  once after the gateway registers it, and again each time its app starts.
  Core treats that as any [restarted app](#operator-requests); there is no
  separate restart signal.
  A gateway that replaces it registers its radios as new Assets.
- When an admin removes a radio Asset, its ID ends. If the radio is heard
  again, its gateway registers it as a new Asset with a new ID.
- A gateway acts only for the Assets it carries. Its calls for any other Asset
  get `403`.
- Removing a gateway leaves its radio Assets in the picture, offline. Replacing
  its key changes nothing for them.

## Contact

Stored contact records describe transitions. An online record keeps the time
of the online transition, rather than every later heartbeat. Offline records
keep the last-heard time.

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

Removing an Asset drops its unfinished Tasks and unanswered requests, with
their drop events. Removing its key leaves the registered Asset in the picture.
Login and account creation use `requests.login` and `requests.account`.

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

These are requirements to test when Core is built; the Administration contract tests exercise them.

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
| `/entities/geofeatures` | Places operators create, edit, and delete, and Plugins create. A Task that names a place by `geofeature_id` carries a copy of it ([Geo features](#geo-features)). |

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
  `/entities/assets/{asset_id}` calls.
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
| `PUT /entities/geofeatures/{geofeature_id}?update_tasks=<true or false>` | `requests.geofeature` | `200 {geofeature, event_id}`, and with `update_tasks=true`, `updated_task_ids` and `not_updated_task_ids` |
| `DELETE /entities/geofeatures/{geofeature_id}` | Nothing | `200 {event_id}` |

- These are local edits. Nothing goes to an Asset unless an operator updates
  Tasks, so Core answers `200` with the stored result, not `202`. The [retry rules](#basics) apply as to every
  change.
- `POST` creates a geo feature, and Core assigns its `geofeature_id`. `PUT`
  replaces one whole, so a name left out is cleared and its shape may change
  kind, except imagery. `DELETE` removes it from the picture. Core never reuses a
  `geofeature_id` in the run, and a deleted one returns `404`.
- Any admin or operator may create, replace, or delete any geo feature,
  including one a Plugin or Asset made. A Plugin may only create geo features,
  with its key ([Plugins](#plugins)). So may an Asset, to place a file it
  [uploads](#objects): an Asset on IP with its key, or a gateway for a radio
  Asset it carries. Any other replace or delete by them gets `403`.
- The event names who asked with `requested_by`, because the geo feature record
  names no author. A geo feature a Plugin or Asset creates names it.
- **A Task keeps a copy of its place.** `move_to` and `land` may name a point
  geo feature by `geofeature_id` instead of a position. When it accepts the
  Task, Core refuses a `geofeature_id` that does not exist with `404` and
  refuses a place that is not a point. It then copies the place's position
  into the Task, beside the `geofeature_id`, so the Task keeps the place as it
  was when it was sent. A shape drawn into one Task is carried by that Task the
  same way.
- **Assets never read places.** Geo features are never sent to Assets or
  gateways, and they read nothing of the picture. Failsafe boundaries and
  failsafe responses never name a geo feature.
- **Edits are never blocked.** An operator may replace or delete a place while
  unfinished Tasks name it. Core does not refuse the change and does not cancel
  any Task. Deleting a place changes no Task already sent.
- **An edit updates Tasks only when asked.** A Task is unfinished until its
  final Asset report is stored. With `update_tasks=true`, Core makes a new copy
  of the place for each unfinished Task that names it and adds one
  `tasks.updated` event per Asset, each Task keeping its `task_id`, so the Asset
  [uses the new copy](../../asset/docs/README.md#carry-out-work-and-report-its-result).
  As for any request, only an online Asset gets it: Tasks of an offline Asset
  are not updated, and the answer lists them in `not_updated_task_ids`. A
  `move_to` or `land` Task whose place is no longer a point keeps its copy and
  is listed there too; the edit itself still goes through. The
  Asset answers with a queue report naming the event, and an update it has not
  answered when it goes offline is dropped like any other request. Without
  `update_tasks=true` the Tasks keep their copies. The
  [Command Interface](../../command-interface/docs/README.md#area-and-place-inputs)
  asks the operator which to do.
- **Imagery shows a GeoTIFF on the map.** An imagery geo feature names one
  stored Object, and the map draws that file where the file says it belongs.
  Core refuses an Object that is not a GeoTIFF with `409`, and an `object_id`
  that does not exist with `404`. A `PUT` on imagery may change only its name;
  any other change, or turning another kind into imagery, is refused with
  `409`. To correct the image, add a new imagery geo feature. Deleting imagery
  leaves its Object.

## Objects

Core accepts imagery only when the file is a TIFF with GeoKeyDirectory tag
34735. Attach requests use `requests.attach`. Attaching an Object to the same
end state adds no event and returns its existing latest Object `event_id`.

An Object is a file Core holds, with an `object` record that says what it is:
`object_id`, `name`, `content_type`, `size_bytes`, and an optional
`geofeature_id`. Operators, Plugins, and Assets store Objects. Core never sends
them to Assets or gateways.

| Request | Who | Result |
| --- | --- | --- |
| `POST /objects?name=<name>&geofeature_id=<id>` | Account, Plugin, or Asset | Stores the file; `201 {object_id, event_id}` |
| `GET /objects?geofeature_id=<id>` | Account or Plugin | Every Object record, or those attached to one geo feature, with `as_of` |
| `GET /objects/{object_id}` | Account or Plugin | One Object record |
| `GET /objects/{object_id}/file` | Account or Plugin | The file, with its `content_type` |
| `PATCH /objects/{object_id}` | Account | `{"geofeature_id": <id or null>}` attaches, moves, or detaches it; `200 {event_id}` |
| `DELETE /objects/{object_id}` | Account | Deletes the Object: hides it and its file for the rest of the run; `200 {event_id}` |

All files, including photos and clips, are Objects
([decision log](../../atlas/decision-log.md#the-picture-and-plugins)).

- **An upload is the file itself.** The body is the file's bytes and its
  `Content-Type` header is the file's type. `name` is required and
  `geofeature_id` is optional. It is the one state change whose body is not
  JSON. The required `Atlas-Definitions` header still keeps other sites from
  sending it. Like every change, it carries an `Idempotency-Key`; a repeat
  stores nothing new.
- **Assets upload what they capture**, such as a photo or a short clip: an Asset
  on IP with its key, or a gateway for a radio Asset it carries when its
  Fieldlink can carry the file. An Asset's file is not put on the map by
  itself. To show where it belongs, the Asset first
  [creates a geo feature](#geo-features), such as a point where the photo was
  taken, then uploads the file naming it. A gateway adds `asset_id=<id>` to
  both calls to say which Asset it acts for, and Core refuses an Asset it does
  not carry with `403`; an Asset on IP needs none, because its key names it.
  `requested_by` is that `asset_id`. An Asset never reads, moves, or deletes an
  Object.
- **Task output names its Objects.** A completed Task report carries the
  `object_ids` of files it made, as [Protocol defines](../../protocol/definitions/records/report/status/task.json).
  These are the IDs returned by upload, not file names.
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
- **Delete hides the Object; it destroys nothing.** After a delete, the Object
  and its file are gone from every read: lists leave it out, and its record
  and file return `410 deleted` with the `deletion` record, so a link to it can
  say who deleted it and when. Core keeps both until the run ends, and the Reset ZIP
  holds them, marked deleted. The `object.stored` and `object.deleted` events
  stay in history, so the record of the upload and of who deleted it remains.
  Only an operator deletes an Object. Core refuses to delete an Object that an
  imagery geo feature still shows with `409`; the operator deletes the imagery
  first.
- **Who stored it** is `requested_by` in the Object record: the account that
  uploaded it, or the Plugin or Asset that stored it. Core stamps it, as for Tasks.
- **Objects belong to their run.** When the run ends, their files, deleted
  ones included, go into Core's [Reset ZIP](reset.md#cores-reset-zip) and are
  cleared from Core. The
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
   record: its name and the actions it offers, as
   [Plugins](../../atlas/plugins.md#actions) describes. Core checks the
   description with Protocol's validator and refuses an invalid one with
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

Every `geofeature_id` and `object_id` in a Plugin answer must exist and have
been created by that Plugin's call. Otherwise Core returns `400 invalid`.
A Plugin supplies `request_id=<call event_id>` on `POST /objects` and
`POST /entities/geofeatures`. Core requires a still-open call addressed to
that Plugin and keeps the creation's call identity. Concurrent calls therefore
cannot claim each other's output.

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
