# Asset configuration

Selected requirements and a discussion inventory for the Asset app. No runtime
is built yet. Configuration selects Asset behavior, using
[modules and equipment drivers](docs/assets.md#modules-and-equipment-drivers).
The exact file format, option names, defaults, overrides, and editing tools
remain open.

## Startup configuration and live settings

Startup configuration describes the Asset's modules, equipment access, explicit
command list, initial behavior, connection to Core, and diagnostic storage.
Live settings describe supported operating values, such as lights, home, or
failure responses. Support is independent of whether a current value is known.
A reporting-only tracker needs no live settings or task queue merely to connect.
Those startup cases need [Protocol contract work](../protocol/docs/open-questions.md#unresolved).
Changing a configuration file is not another route for sending commands.

The app validates startup configuration before connecting and exposes the
effective configuration with secrets removed. A local inspection command shows
the selected modules and equipment, supported commands, reporting policy, and
enabled failsafes. It identifies missing or incompatible configuration without
moving equipment or claiming it is ready. The same check runs in CI without
hardware. Loading from one local file is proposed. Command syntax, storage, and
configuration changes during an operation remain open.

## Options to discuss

Names in this table are proposed configuration keys, not an implemented format.

| Option | Purpose | Selected requirement or open choice |
| --- | --- | --- |
| `asset_id`, `asset_key`, `enrollment_key` | Identity and registration credentials | Follow [registration](../protocol/docs/storage.md#registration); provisioning and local storage remain open |
| `link` | Core endpoint and available transports or transport interfaces | Communications module manages SDK configuration; see [communications goals](docs/communications.md); exact configuration shape is open |
| `modules`, `equipment` | Explicit behavior modules, movement profiles, equipment drivers, and their connections | No silent module overrides; full catalog, interfaces, and equipment options remain open |
| `capabilities` | Explicit supported commands, reports, cameras, and settings support | Command list is supplied outright; settings-support representation needs Protocol work |
| `position` | Own position source or a configured stationary position | Equipment or manual configuration supplies it; missing values stay unknown |
| `initial_settings` | Initial values for supported live settings | Use shared settings fields where defined; explicit home takes precedence over automatic initialization |
| `startup_behavior` | Acquisition, reporting, and initial equipment behavior | Initial example setups report automatically and wait for movement requests; other behavior is Asset-selected |
| `completion_tolerances`, `command_timeouts` | Evidence and limits for equipment execution | Per-command values and failure mappings remain open |
| `reporting` | Selection and rate of outgoing reports from local state | Communications module considers data relevance and available links; thresholds and rates remain open; no mandatory periodic health snapshots |
| `log_level` | Detail of app and SDK diagnostics | Detailed per-message logging is required; proposed prototype default is `trace` |
| `log_directory` | Local diagnostic files | Available while Core is unreachable; destination remains open |
| `log_message_content` | Message content in trace records | Proposed on for the prototype, with credentials removed |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Rotation and local storage usage | Capacity and incomplete-log handling remain open |
| `archive_directory` | The Asset's own Reset ZIPs | Destination and export trigger remain open |

[SDK configuration](../sdk/config.md) owns library controls. The communications
module supplies those controls and collects SDK diagnostics. Equipment-specific
configuration belongs with its equipment driver or behavior module. Exact
movement-profile selection and switching rules remain open.

## Failsafe configuration

[Failsafes](docs/failsafes.md) owns the default empty rule list, conditions,
response Tasks, and live policy replacement. Subsystem reporting does not
activate a response by itself. Only explicitly configured policies do so.

Exact configuration fields and the division between local startup configuration
and shared live settings remain open. Protocol's current settings cannot yet
express the selected policy model.

## Logging

[Logging](docs/logging.md) owns diagnostic evidence and Reset archives. Collection
is local and does not depend on streaming logs over the field link.
