# Core configuration

Discussion draft for the future Core runtime. Detailed logging and easy setup
are selected requirements. The option names, defaults, file format, and loading
rules below are proposals unless an existing source is linked. None of these
proposed options is implemented by this document.

## Configure and inspect one Core

Proposed setup: load one local configuration file, allow explicit deployment
overrides, and show the effective configuration with secrets removed before
opening links. Report an invalid option by name and explain what is wrong.
This gives a field deployment and a hosted deployment the same starting point.

Decide the file format, override precedence, and command-line interface before
implementation. There is no configuration server or live-reload requirement.

## Options to discuss

Names in this table are proposed configuration keys.

| Option | Purpose | Starting point or open choice |
| --- | --- | --- |
| `listen_address`, `port` | Where gateways and operator clients connect | Support hosted and field deployments; address and port defaults are open |
| `data_directory` | Normal state, retained history, and Object files | Storage engine and directory layout remain open |
| `enrollment_key` | Allow new Assets to register | Required by the [registration contract](../protocol/docs/storage.md#registration); secret source is open |
| `operator_keys` | Credentials accepted from operator clients | Provisioning and input format remain open |
| `log_level` | Detail of component and SDK diagnostics | Detailed per-message logging is required; proposed prototype default is `trace` |
| `log_directory` | Local diagnostic files | Keep apart from normal state tables; path is open |
| `log_message_content` | Include message content in trace records | Proposed on for the prototype, with credentials removed |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Rotation and disk usage | Limits are open; do not silently discard a run's evidence |
| `archive_directory` | Completed Reset ZIPs | Path and export trigger are open |
| `run_retention_days` | Retention of completed run archives | The [scale direction](../atlas/scale.md#runs-and-storage) is at least 30 days |

SDK connection and request controls are inventoried in [SDK configuration](../sdk/config.md).
How Core supplies those controls is still open. Plugin-specific configuration
waits for the Plugin runtime design.

## Logging and Reset

[Core logging](docs/logging.md) owns what Core records and how that evidence
contributes to its Reset ZIP. Configuration chooses the destination and level;
it does not redefine the logging contract or the Protocol's data formats.

## Existing prototype options

These are implemented in [src/main.mjs](src/main.mjs), not selected as the future
configuration interface. The retained runtime does not provide the proposed
diagnostic configuration above.

| Environment variable | Existing behavior |
| --- | --- |
| `PORT` | Listen port, default `8080` |
| `ATLAS_DB` | SQLite file; omitted means an in-memory store |
| `ATLAS_ENROLLMENT_KEY` | Enrollment credential |
| `ATLAS_OPERATORS` | Comma-separated `operator_id:key` pairs |

## Decisions still needed

- Required options, defaults, secret loading, and configuration-file format.
- Whether any configuration can change during an operation.
- Rotation limits and behavior when logging cannot keep up or storage fills.
- Reset invocation, archive verification, and what Reset clears after export.
