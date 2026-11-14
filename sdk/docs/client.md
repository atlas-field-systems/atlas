# Client

How a program calls the Core API through the SDK. Endpoints, status codes and
bodies are in [the Core API doc](../../core/docs/api.md); this page covers what the
client does around them.

## Credentials

The caller's kind decides its credential, as in
[Callers and credentials](../../core/docs/api.md#callers-and-credentials).

- **Browser accounts.** `login(operator_id, password)` calls `POST /administration/login`. Core
  sets an `HttpOnly` session cookie, so the SDK never sees or stores it; the
  browser sends it on every request, and every tab shares one session.
- **Assets, gateways, and Plugins.** The program passes its key when it creates the client.
  The SDK sends it as `Authorization: Bearer <key>` on every request and the event
  stream.

A `401` means the session or key is no longer valid. The client stops
reconnecting the event stream until the program logs in again or supplies a new
key. The SDK never puts a credential in a record, a URL, or a
[diagnostic event](logging.md).

## Definitions check

The host passes loaded Protocol definitions to the client. The hash follows Protocol's
[recipe](../../protocol/docs/decisions.md#definitions-hash), so every program
that loads the same definition files gets the same hash. `connect()` calls
`GET /about` and compares `definitions_hash` with its
own. On a mismatch, `connect()` returns `definitions_mismatch` with both hashes.
Every later call returns the same result without sending. A client with a key
sends its key and hash on `GET /about`, so Core
[records the mismatch](../../core/docs/api.md#basics) for operators.

Every request carries `Atlas-Definitions: <hash>`, and the event stream carries
`?definitions=<hash>` ([Basics](../../core/docs/api.md#basics)). A
`409 definitions_mismatch` from Core at any time stops the client the same way.
The client never reinterprets records it cannot validate.

## Validation

Before sending, the client checks every body record (a Task, a settings
change, a description, reports) with Protocol's validator. A body that fails is a
programmer error. The call throws with the failing paths and sends nothing.
`validate(name, record)` returns the same check as a value, so a form can show errors
before the operator submits.

## Retries and idempotency

Each state-changing call gets a fresh random `Idempotency-Key`. The client retries a network failure or a `5xx`
with the same key and the same body, with backoff, until the request timeout.
Core returns the retained non-secret response for a repeated key, so a retry
never repeats an effect. Credential and login retries follow the
[Core API's acknowledgment and recovery rules](../../core/docs/api.md#callers-and-credentials).
The client never retries a `4xx`.

If no response arrives before the timeout, the result is `unknown`. Core may or
may not have accepted the request. `unknown` is not failure. It carries `retry()`,
which sends again with the same key and body. Reads retry the same way without a
key.

## Results and errors

Anything Core or the network can decide is a result value. Bugs in the calling
program throw.

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number; explanation: string;
      retry?: () => Promise<Result<T>> };
```

- `error` is Core's code (`invalid`, `definitions_mismatch` and the others in
  [Basics](../../core/docs/api.md#basics)), or `unknown` when no response arrived.
- The client throws for a body that fails validation, a call before `connect()`
  or after `close()`, and a call the credential cannot make, such as `login` on a
  keyed client.

## Accepted is not done

A `202` result means Core accepted the request and appended it to its log. It
does not mean the Asset did anything. The outcome arrives later on the
[event stream](live.md) as a report:

- A Task's state arrives in `report.status` Task reports naming its `task_id`.
- A Task request, a settings change or a cancel is answered by a report whose
  `request_id` is the request's `event_id`.

The client offers no "wait until done" call. A program that needs the outcome
follows the stream and matches these fields.

## Calls

The typed `call(name, {params, query, body})` uses the route table in
[src/routes.ts](../src/routes.ts). Credential types limit route names,
and Protocol types describe bodies. Each call maps to one endpoint in
[Operator requests](../../core/docs/api.md#operator-requests),
[Reads](../../core/docs/api.md#reads),
[Asset and gateway calls](../../core/docs/api.md#asset-and-gateway-calls), or
[Accounts and provisioning](../../core/docs/api.md#accounts-and-provisioning).

```ts
const atlas = createClient({ baseUrl, protocol, credential: { kind: 'account' },
  clock: systemClock, fetch, observer });
const ready = await atlas.connect();
if (!ready.ok) return show(ready.explanation);
await atlas.login(operator_id, password);
const sent = await atlas.call('sendTasks', {
  params: { asset_id }, body: { tasks }
});
const stream = follow(atlas, { after, asset_id }, onEvent);
atlas.close();
```

Admin calls (accounts, Assets, gateways, Plugins, keys), Object uploads, and
Plugin calls follow the same pattern. The SDK
hands a key that Core returns once to the caller and never logs it. `history`
follows `next_cursor` page by page and stops when the caller stops iterating.

## Gateways

A gateway uses one client with its own key and makes the
[Asset calls](../../core/docs/api.md#asset-and-gateway-calls) on behalf of each
Asset it carries. Its event stream shows the requests for those Assets, which its
Fieldlink carries to them. The [queue helper](asset.md#the-queue-helper) runs
with the Asset app: on the radio Asset, or on the gateway when its Fieldlink
[runs the Asset app there](../../fieldlink/README.md#two-kinds-of-fieldlink). The gateway names each radio it hears and
reports its contact as the [Core API](../../core/docs/api.md#radio-assets) sets.

## Plugins

A Plugin uses one client with its own key and makes the
[Plugin calls](../../core/docs/api.md#plugins): it describes itself, follows its
event stream for the calls addressed to it, stores what it creates, and posts one
answer per call. The SDK keeps the Plugin in contact while it is idle.


## Run changes and idle contact

A connection binds one run. After a transport failure, the client checks
`/about` before resending. A new run fences every old retry and returns
`run_ended` without sending. Call `connect()` to bind the new run after
discarding the old state. An invalid response returns `invalid_response`.

Gateway and Plugin clients use `holdContact()` while idle. It checks `/about`
after `heartbeatMs` without a request. Stop its handle when the host ends.
It stops on lost authentication, a mismatch, a new run, or client close.
