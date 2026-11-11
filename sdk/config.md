# SDK configuration

The SDK is a library. Its host passes these options when it creates the client;
there is no SDK configuration file. Values are proposed defaults for discussion.

| Option | Purpose | Proposed default |
| --- | --- | --- |
| `baseUrl` | Core's HTTPS address | Required, except same-origin in a browser |
| `key` | Bearer key for an Asset or gateway; leave out for browser accounts | None |
| `requestTimeoutMs` | How long a call retries before it returns `unknown` | 10000 |
| `backoff` | Retry and reconnect delays: minimum, maximum, factor, jitter | 500 ms, 30 s, 2, 0.2 |
| `streamIdleMs` | No data or keepalive for this long and the stream is reopened | 30000 |
| `maxBatch` | Most reports in one Asset batch | Open |
| `heartbeatMs` | How often an idle Asset posts an empty batch | Open; shorter than Core's `offline_after_s` |
| `observer` | Receives [diagnostic events](docs/logging.md) | None |

Tests may also swap the clock and `fetch`. Those are test hooks, not settings.

## Open items

- The package name and how the SDK is released.
- How Protocol computes the definitions hash and exposes it to the SDK.
- `maxBatch`, and whether Core caps batch size.
- Whether the queue helper or the cursor survive a process restart.
- Which of these options a host shows to its operator.
- Event filtering before the observer, and the dropped-event policy.
