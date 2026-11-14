# Core configuration

Run `node src/main.ts <config.json>` with Node 24. Core loads a JSON object,
then applies `ATLAS_CORE_<KEY>` environment overrides. Values use JSON syntax;
a plain string is also accepted for string options. Unknown keys and invalid
values stop startup with the option name and an explanation.

There is no live configuration reload. Core rereads configured TLS PEM files
hourly so certificate renewal does not require a Reset. Both files are required
for HTTPS. Without them Core listens only on loopback.

## Defaults

| Option | Default |
| --- | --- |
| `listen_address`, `port` | `127.0.0.1`, `8443`; without TLS, a non-loopback address is refused |
| `tls_certificate`, `tls_key` | `null`, `null` |
| `data_directory` | `/var/lib/atlas-core` |
| `first_admin` | `null`; or `{operator_id, password_file}`, used only if no account exists |
| `offline_after_s` | `30` |
| `max_object_bytes` | `100000000` |
| `clock_ahead_s` | `10` |
| `log_level` | `trace` |
| `log_directory` | `<data_directory>/diagnostics` |
| `log_message_content` | `true`; credentials removed |
| `log_file_limit_bytes` | `67108864` (64 MiB) |
| `log_total_limit_bytes` | `2147483648` (2 GiB) |
| `debug_endpoint` | `false` |
| `archive_directory` | `<data_directory>-archive`; Core never deletes ZIPs |

`port` accepts 0 to choose a free port. Timeouts and limits must be positive.
The password file is read once for bootstrap, with a trailing newline removed.
Accounts and keys are otherwise provisioned through the [Core API](docs/api.md#accounts-and-provisioning).
[Logging](docs/logging.md) owns diagnostics and [Reset](docs/reset.md) owns archives.

Core refuses startup with the reason if `archive_directory` is inside or equal to
`data_directory`, after resolving symbolic links, so Reset cannot erase its ZIP.
