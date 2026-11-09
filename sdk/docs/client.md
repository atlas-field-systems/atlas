# Client

How a program calls the Core API through the SDK. Endpoints, status codes and
bodies are in [the Core API doc](../../core/docs/api.md); this page covers what the
client does around them.

## Credentials

The caller's kind decides its credential, as in
[Callers and credentials](../../core/docs/api.md#callers-and-credentials).

- **Browser accounts.** `login(operator_id, password)` calls `POST /login`. Core
  sets an `HttpOnly` session cookie, so the SDK never sees or stores it; the
  browser sends it on every request, and every tab shares one session.
- **Assets and gateways.** The program passes its key when it creates the client.
  The SDK sends it as `Authorization: Bearer <key>` on every request and the event
  stream.

A `401` means the session or key is no longer valid. The client stops
reconnecting the event stream until the program logs in again or supplies a new
key. The SDK never puts a credential in a record, a URL, or a
[diagnostic event](logging.md).

## Definitions check

The client loads Protocol's definitions and their hash from its Protocol package
dependency. `connect()` calls `GET /about` and compares `definitions_hash` with its
own. On a mismatch it refuses to work: `connect()` returns `definitions_mismatch`
with both hashes, and every later call returns the same result without sending.

Every request carries `Atlas-Definitions: <hash>`, and the event stream carries
`?definitions=<hash>` ([Basics](../../core/docs/api.md#basics)). A
`409 definitions_mismatch` from Core at any time stops the client the same way.
The client never reinterprets records it cannot validate.

## Validation

Before sending, the client checks every body record (a Task, a queue, a settings
change, a description, reports) with Protocol's validator. A body that fails is a
programmer error: the call throws with the failing paths and sends nothing.
`validate(record)` returns the same check as a value, so a form can show errors
before the operator submits.

## Retries and idempotency

Each state-changing call gets a fresh random `Idempotency-Key`. The client retries a network failure or a `5xx`
with the same key and the same body, with backoff, until the request timeout.
Core returns the stored response for a repeated key, so a retry never repeats an
effect. A `4xx` is never retried.

If no response arrives before the timeout, the result is `unknown`: Core may or
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
- **Thrown:** a body that fails validation, a call before `connect()` or after
  `close()`, and a call the credential cannot make, such as `login` on a keyed client.

## Accepted is not done

A `202` result means Core accepted the request and appended it to its log. It
does not mean the Asset did anything. The outcome arrives later on the
[event stream](live.md) as a report:

- A Task's state arrives in `report.status` Task reports naming its `task_id`.
- A settings change, a cancel or a queue is answered by a report whose
  `request_id` is the request's `event_id`.

The client offers no "wait until done" call. A program that needs the outcome
follows the stream and matches these fields.

## Surface sketch

Names are a planning sketch. Each call maps to one endpoint in
[Operator requests](../../core/docs/api.md#operator-requests),
[Reads](../../core/docs/api.md#reads),
[Asset and gateway calls](../../core/docs/api.md#asset-and-gateway-calls), or
[Accounts and provisioning](../../core/docs/api.md#accounts-and-provisioning).

```ts
const atlas = createClient({ baseUrl, key, observer });  // key: Assets and gateways only
const ready = await atlas.connect();                     // GET /about, hash check
if (!ready.ok) return show(ready.explanation);

await atlas.login(operator_id, password);                // browser accounts
const task = await atlas.createTask(asset_id, body);     // { task_id, event_id }
await atlas.setQueue(asset_id, { queue_version, task_ids });
await atlas.changeSettings(asset_id, settings);
await atlas.cancel(asset_id, task_id);

await atlas.assets();  await atlas.asset(asset_id);  await atlas.tasks(asset_id);
for await (const page of atlas.history({ asset_id, report, since, until })) { /* ... */ }

atlas.follow({ after, asset_id }, onEvent);              // see live.md
atlas.close();
```

Admin calls (accounts, Assets, gateways, keys) follow the same pattern. A key that
Core returns once is handed to the caller and never logged. `history` follows
`next_cursor` page by page and stops when the caller stops iterating.

## Gateways

A gateway uses one client with its own key and makes the
[Asset calls](../../core/docs/api.md#asset-and-gateway-calls) on behalf of each
Asset it carries. Its event stream shows the requests for those Assets, which its
Fieldlink carries to them. The [queue helper](asset.md#the-queue-helper) runs on
the radio Asset, not on the gateway. How a gateway is bound to its Assets and
reports their contact is [not defined yet](../../core/docs/api.md#not-defined-yet).
