# Asset configuration

Discussion draft for the Asset app. Detailed local logging and easy setup are
selected requirements. The names and loading rules below are proposals; this
folder has no runtime implementation yet.

## Startup configuration and live settings

Startup configuration describes the device, its equipment connection, how it
reaches Core, and where it records diagnostics. Live settings describe its current
operating state, such as lights, home, and failure responses. Their exact shared
fields remain in [Protocol's settings component](../protocol/definitions/components/settings.json).

Proposed setup: one local configuration file, validated before connecting, with
an inspectable effective configuration that excludes secrets. File format,
overrides, and editing tools are not selected yet.

## Options to discuss

Names in this table are proposed configuration keys.

| Option | Purpose | Starting point or open choice |
| --- | --- | --- |
| `asset_id`, `asset_key`, `enrollment_key` | Identity and registration credentials | Follow [registration](../protocol/docs/storage.md#registration); provisioning and local storage are open |
| `link` | Core endpoint or field-link adapter and its local connection | Select the transport used by this deployment; configuration shape is open |
| `equipment` | Flight controller, sensor, or other equipment connection | Integration and required connection options are open |
| `capabilities` | Reports, commands, and cameras exposed by this Asset | Must describe actual equipment support; whether supplied or discovered is open |
| `initial_settings` | Initial values for supported live settings | Use Protocol's settings fields; the app sets home from its startup position |
| `completion_tolerances`, `command_timeouts` | How equipment confirms an action or reports failure | Per-command values and failure mappings are not decided |
| `log_level` | Detail of app and SDK diagnostics | Detailed per-message logging is required; proposed prototype default is `trace` |
| `log_directory` | Local diagnostic files | Remains available while the Core link is down; destination is open |
| `log_message_content` | Include message content in trace records | Proposed on for the prototype, with credentials removed |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Rotation and local storage usage | Capacity and incomplete-log handling remain open |
| `archive_directory` | The Asset's own Reset ZIPs | Destination and export trigger are open |

[SDK configuration](../sdk/config.md) lists the client-library controls. The app
supplies supported initial settings; live operator changes then follow
[the Asset settings rules](../protocol/docs/communication.md#settings).
Changing a configuration file is not an alternative route for sending commands.

## Logging and Reset

[Asset logging](docs/logging.md) owns the equipment evidence, app decisions, and
SDK diagnostics included in the Asset's own archive. Collection is local and
does not depend on streaming logs to Core over the field link.

## Decisions still needed

- Required startup values, defaults, and credential provisioning.
- The equipment-specific options and how supported settings are established.
- Which options can change during an operation, and through which interface.
- Diagnostic storage capacity, Reset invocation, and how archives are retrieved.
