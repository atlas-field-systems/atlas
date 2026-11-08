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

[Platform integration](docs/assets.md#proposed-platform-integration) proposes
equipment code and configuration for each platform within a shared Asset app.
Setup needs to identify the platform's execution procedures and physical arming
requirements. How these are selected, and which choices belong in code rather
than configuration, remain open. Startup configuration selects how the Asset
executes work; it does not itself request arming or takeoff.

## Failsafe configuration

The default Atlas failsafe configuration has no rules. Every rule is added
explicitly; there is no mandatory battery, contact, idle, or area rule. A
reporting-only beacon has no failsafe.

[Command failures and failsafes](docs/failsafes.md) selects configurable trigger
conditions and their responses. Contact policy needs to distinguish an Asset
carrying out onboard work from one still airborne with no work left. It must
support intentionally waiting without contact, such as when a link will be
brought to the Asset later. Trigger timing, defaults, and option names remain open.

The response-Task direction adds combined conditions, a no-Tasks timer that may be
zero, and a horizontal polygon supplied directly as coordinates. Every rule requires
all its conditions; alternative combinations are separate rules with an explicit
priority order. Responses configure supported actions with their parameters, and
each activation creates a fresh Task. A response may include one fallback Task.
Battery rules and their priorities are configured explicitly. Area-exit tolerance
uses a configurable distance and duration, both of which may be zero. Running
response parameters are fixed at Task start.

During ordinary operation, operators may replace the complete failsafe configuration.
Validate the replacement before applying it; reject an invalid replacement and
retain the previous one. Execution-affecting edits remain locked after failsafe
activation for the rest of the operation. No recovery or recovery-edit mechanism
is in scope. Exact shared formats remain under discussion.

Accepted replacements immediately evaluate existing measurements and elapsed
times; they do not restart idle or contact timers.

The current Protocol settings do not yet express those separate conditions.
Local configuration and shared live settings must be distinguished when their
formats are selected. Command-failure cancellation is unconditional, regardless
of failsafe configuration.

## Logging and Reset

[Asset logging](docs/logging.md) owns the equipment evidence, app decisions, and
SDK diagnostics included in the Asset's own archive. Collection is local and
does not depend on streaming logs to Core over the field link.

## Decisions still needed

- Required startup values, defaults, and credential provisioning.
- The equipment-specific options and how supported settings are established.
- Which options can change during an operation, and through which interface.
- Diagnostic storage capacity, Reset invocation, and how archives are retrieved.
