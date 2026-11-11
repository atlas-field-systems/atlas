# Asset configuration

A discussion draft for the Asset app; nothing is implemented. Configuration
selects the Asset's [modules and equipment drivers](docs/assets.md#modules-and-equipment-drivers)
and how it reaches Core.

## Startup configuration and live settings

Startup configuration describes the Asset's modules, equipment access, supported
commands, startup behavior, connection to Core, and diagnostic storage. Live
settings are shared operating values, such as lights, home, pause, or
`link_loss_after_s`; Protocol defines them and operators change them through
Core. Editing a configuration file is not another way to send commands.

The app validates its configuration before connecting. A local inspection
command shows the effective configuration with secrets removed: modules,
equipment, supported commands, reporting policy, and enabled failsafes. It names
missing or incompatible options without moving equipment. The same check runs in
CI without hardware. The proposal is to load one local file.

## Options to discuss

Names are proposed keys, not an implemented format.

| Option | Purpose | Notes |
| --- | --- | --- |
| `asset_id`, `asset_key` | Identity and credential | For an Asset on IP, an admin [provisions it in Core](../core/docs/api.md#accounts-and-provisioning) and copies both here. There is no enrollment key. An Asset behind a gateway has no `asset_key`; it learns its `asset_id` from its gateway |
| `link` | How the Asset reaches Core: a Core URL for the SDK client on IP, or a Fieldlink and its radio | See [communications](docs/communications.md) |
| `modules`, `equipment` | Behavior modules, movement profiles, equipment drivers, and their connections | Built-in modules are never silently overridden |
| `commands` | The supported commands, listed outright | Sent in the Asset's description |
| `position` | Own position source, or a configured stationary position | Missing values stay unknown |
| `initial_settings` | Starting values for supported live settings | An explicit home takes precedence over automatic home. Includes the starting `failsafe_policy` |
| `startup_behavior` | Acquisition, reporting, and initial equipment behavior | Example setups report at once and wait for movement Tasks |
| `completion_tolerances`, `command_timeouts` | Evidence and limits for equipment execution | Per command |
| `reporting` | Which reports to send from local state, and how often | No mandatory periodic health snapshots |
| `log_level` | Detail of app, SDK client, and Fieldlink diagnostics | Proposed prototype default is `trace` |
| `log_directory` | Local diagnostic files | Works while Core is unreachable |
| `log_message_content` | Request and report content in trace records | Proposed on for the prototype, credentials removed |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Rotation and storage use | |
| `archive_directory` | The Asset's own Reset ZIPs | |

Equipment-specific options belong with their equipment driver or module.
[Failsafes](docs/failsafes.md) owns the failsafe policy, and
[logging](docs/logging.md) owns what is recorded.

## Open

- File format, defaults, secret storage, and editing tools.
- Whether any configuration can change during an operation.
- How movement profiles are selected and switched.
- Log capacity, incomplete-log handling, and the archive export trigger.
