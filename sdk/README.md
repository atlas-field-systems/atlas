# Atlas SDK

The SDK is the TypeScript client for the [Core API](../core/docs/api.md). Programs
outside Core's [inner wall](../atlas/design-decisions.md#a-walled-city) use it to reach Core:

- The Command Interface, in the browser, logged in to an operator or admin account.
- Assets on IP, with their own key.
- Gateways, with their own key, calling on behalf of the radio Assets they carry.
- Plugins, with their own key, following their calls and answering them.

The SDK handles credentials, the definitions check, idempotency keys and retries.
It follows the event stream and manages the Asset's reports and queue. Core's
[API doc](../core/docs/api.md) is the single source for endpoints and wire
behavior; these pages describe only what the client adds and link there for the rest.

Records come from [Protocol](../protocol/README.md). The SDK loads Protocol's
definitions as data, validates with Protocol's one validator, and defines no record
of its own. Compile-time shapes come from [Protocol
types](../protocol/docs/decisions.md#typescript-types).

## Non-goals

- **Core does not use the SDK.** Core implements the API; the SDK calls it.
- **No field links.** Gateways and radio Assets run Fieldlinks, which are their own
  package. The SDK's [Asset helpers](docs/asset.md#on-a-radio-asset) work over a
  Fieldlink, but the SDK contains none.
- **No flying.** Helpers carry requests, reports and contact. The Asset app owns
  motion, equipment checks and failsafes.
- **No second validator** and no generated clients.
- **No live picture on Assets.** It is optional and meant for operator apps.

The SDK takes its clock and its connection to Core from the program that
creates it, so [Simulations](../simulations/README.md#what-each-part-allows) can
run it unchanged against a faulty network.

## Docs

| Doc | What it covers |
| --- | --- |
| [Client](docs/client.md) | Credentials, the definitions check, requests, retries, results and errors |
| [Live](docs/live.md) | Following the event stream, reconnecting, and the optional live picture |
| [Asset](docs/asset.md) | Startup, report batches, and the Task queue helper for an Asset |
| [Logging](docs/logging.md) | Diagnostic events delivered to the host |
| [Configuration](config.md) | Client options and the open items |

## Status

These docs are a draft; no runtime code is built. The SDK uses TypeScript
throughout. Node 24 runs the `.ts` sources directly, and browser builds may be
bundled.
