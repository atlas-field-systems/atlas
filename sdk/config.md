# SDK configuration

The host passes these options to `createClient`. There is no SDK configuration
file. The private package is `@atlas/sdk`.

| Option             | Purpose                                     | Default                               |
| ------------------ | ------------------------------------------- | ------------------------------------- |
| `baseUrl`          | Core's address                              | Required except same-origin browser   |
| `protocol`         | Protocol's loaded definitions and `hash`    | Required                              |
| `credential`       | Account, Asset, gateway, or Plugin identity | Required                              |
| `clock`            | All SDK time and timers                     | Required; use `systemClock` in a host |
| `fetch`            | Connection to Core                          | Required; pass the host's fetch       |
| `requestTimeoutMs` | Retry deadline before `unknown`             | 10000                                 |
| `backoff`          | `minMs`, `maxMs`, `factor`, `jitter`        | 500, 30000, 2, 0.2                    |
| `streamIdleMs`     | Idle stream deadline                        | 30000                                 |
| `heartbeatMs`      | Gateway and Plugin contact interval         | 10000                                 |
| `observer`         | Receives [diagnostics](docs/logging.md)     | None                                  |

Asset helpers also take a clock and `heartbeatMs`, defaulting to 10000.
Keep that interval shorter than Core's
[`offline_after_s`](../core/config.md).
The outbox caps a batch at 1000, the [Core cap](../core/docs/api.md#asset-and-gateway-calls).

Clock and fetch are normal host inputs, as
[Simulations](../simulations/README.md#what-each-part-allows) explains.
In Node, load Protocol with `loadPackagedProtocol()`. In a browser, use
`loadProtocol(files)` from `@atlas/protocol/browser`.
Both expose `protocol.hash`.

## Open items

- Package release and tagging.
- Which options a host shows to its operator.
