# Core configuration

Discussion draft for the Core runtime. Detailed logging and easy setup are
selected requirements. The option names, defaults, file format, and loading
rules below are proposals. None is implemented.

## Configure and inspect one Core

Proposed setup: load one local configuration file, allow explicit deployment
overrides, and show the effective configuration with secrets removed before
accepting requests. Report an invalid option by name and explain what is wrong.
Field and hosted deployments use the same setup.

Decide the file format, override precedence, and command-line interface before
implementation. There is no configuration server or live-reload requirement.

## Options to discuss

Names in this table are proposed configuration keys.

| Option | Purpose | Starting point or open choice |
| --- | --- | --- |
| `listen_address`, `port` | Where the [Core API](docs/api.md) listens | Support hosted and field deployments; defaults are open |
| `tls_certificate`, `tls_key` | HTTPS for the Core API | Source and renewal are open |
| `data_directory` | The SQLite database ([storage](docs/storage.md)) and Object files | Directory layout is open |
| `first_admin` | The first admin account's `operator_id` and password | Used only when no account exists; secret source is open |
| `offline_after_s` | How long without contact before Core counts an Asset, gateway, or Plugin offline | See [contact](docs/api.md#contact) and [Plugins](docs/api.md#a-plugin-starts); default is open |
| `max_object_bytes` | The largest file an [Object](docs/api.md#objects) may be | 100 MB; an admin may change it |
| `clock_ahead_s` | How far ahead of Core's clock a report's time may be before Core [marks it](docs/api.md#asset-and-gateway-calls) | Default is open |
| `log_level` | Detail of diagnostics | Detailed per-request logging is required; proposed prototype default is `trace` |
| `log_directory` | Local diagnostic files | Keep apart from the event log; path is open |
| `log_message_content` | Include request and report content in trace records | Proposed on, with credentials removed |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Rotation and the most one run's diagnostics may use | Defaults are open. Past the total, records are counted as a [gap](docs/logging.md#when-logging-cannot-keep-up), never silently lost |
| `debug_endpoint` | Serve the diagnostic log over HTTP with no credential ([logging](docs/logging.md#read-the-log-while-core-runs)) | Off by default. While it is on, anyone who has the URL that Core prints at startup can read the log |
| `archive_directory` | Where Core writes each run's [Reset ZIP](docs/reset.md) when it stops | Path is open. Core never deletes from it |

Accounts and the keys of Assets on IP, gateways, and Plugins are provisioned
through the [Core API](docs/api.md#accounts-and-provisioning), not
configuration. A Plugin's own settings, such as which
services it uses, belong to the Plugin, not to Core.

## Logging and Reset

[Core logging](docs/logging.md) owns what Core records and how that evidence
contributes to its Reset ZIP, and [Reset](docs/reset.md) owns the ZIP. Configuration sets the destination and level;
it does not redefine the logging contract or Protocol's records.

## Decisions still needed

- Required options, defaults, secret loading, and configuration-file format.
- Whether any configuration can change during an operation.
- Default rotation and total limits for diagnostics.
