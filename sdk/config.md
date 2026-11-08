# SDK configuration

The SDK is a library inside Core, an Asset app, or another program. It has no
separate configuration service, log directory, or Reset ZIP. Its host supplies
options and collects the SDK's diagnostics. Runtime code is not built yet.

This inventory distinguishes controls already in the SDK draft from proposed
logging controls. Exact operator-facing exposure remains a host-app decision.

## Controls already in the draft

The linked SDK pages own signatures and defaults. Link sketches need revision
once Protocol defines early and minimal startup and independent settings support.
A reporting-only Asset with no queue needs no queue helper or settings placeholder.

This inventory does not create a second set of defaults or turn every test hook
into a deployment setting.

| Area | Controls | Authority |
| --- | --- | --- |
| Definitions | `loadDefinitions({dir})` | [Messages](docs/messages.md#definitions-and-check) |
| Identity | Identity, role, credentials, `dedupeSize` | [Identity and duplicates](docs/identity-and-duplicates.md) |
| Links | Transport, codec, `helloTimeoutMs`, Asset description and connect settings | [Links](docs/links.md#link) |
| Reconnect | Backoff minimum, maximum, factor, and jitter | [Reconnect](docs/links.md#reconnect-d8) |
| Calls | `timeoutMs`, `maxItems`, cancellation signal, and the pending-request limit | [Calls](docs/calls.md) |
| Asset queue | Local task state and final-report retry timing | [Task queue](docs/task-queue.md) |
| Picture | Opt-in live picture | [Live picture](docs/live-picture.md) |
| Diagnostics | The host-provided observer | [SDK logging](docs/logging.md) |

Clock and transport fault injection are test controls. Exposing a setting must
not weaken a Protocol requirement: for example, the dedupe minimum and required
acknowledgement retries still apply. Which timing values become supported public
knobs rather than test hooks remains open.

## Logging controls to discuss

Detailed SDK logging is a selected requirement for Core and Asset deployments.
The host's logger receives the SDK event stream through the observer. The host
selects the log destination, detail level, rotation, and archive retention in
[Core configuration](../core/config.md) or [Asset configuration](../asset/config.md).

Proposed controls are a detail level and message-content capture policy, with
full tracing for the prototype. Their API names, defaults, and filtering location
are not selected yet. Credentials are excluded from diagnostic output.

## Decisions still needed

- Which existing SDK controls the host exposes to its operator.
- Whether event filtering happens before the observer or in the host logger.
- A bounded event-delivery policy and how dropped diagnostic records are counted.
- Public logging option names and any adapter-specific diagnostic controls.
