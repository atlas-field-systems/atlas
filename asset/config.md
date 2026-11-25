# Asset configuration

[Asset status](README.md) owns implementation status. Configuration
selects the Asset's [modules and equipment drivers](docs/assets.md#modules-and-equipment-drivers)
and how it reaches Core.

**Every behavior value is configurable per Asset.** Tolerances, timeouts, waits,
and limits that shape how an Asset behaves are set in that Asset's
configuration, never fixed in the app, because Assets set up differently respond
differently ([decision log](../atlas/decision-log.md#operations-and-setup)). A
default here is only a starting point.

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
CI without hardware. Flying configurations require a critical battery rule.
The app loads one local JSON file.

For the IP link, startup requires the effective `link_loss_after_s` to exceed
Core's keepalive interval. An omitted value uses the
[Protocol default](../protocol/definitions/variables/link_loss_after_s.json). The SDK reads the interval from
Core before registration; inspection alone cannot check a remote Core.
See [Core contact](../core/docs/api.md#contact).
For Meshtastic, inspection and startup refuse values below 15 seconds.
See [Meshtastic timing](../fieldlink/meshtastic/README.md#first-implementation).

## Inspect a configuration

With Node 24, run `npm ci` in Protocol, Core, the SDK, and Asset, in that order.
From `asset/`, run `node src/main.ts inspect examples/copter.json`.
The command reads one JSON file, validates it, prints the effective configuration
with `asset_key` and URL credentials removed, and exits without opening equipment or Core. Invalid
configuration exits with status 1 and names the affected options.

The [copter example](examples/copter.json) uses IP. It requires
explicit behavior values. Its values are provisional until verified in SITL.
`description` is the Protocol registration body and lists supported capabilities.
`equipment.kind` selects `ardupilot` with a TCP host, port, heartbeat interval in
seconds, and GCS system ID, `simulated` with a stationary position, or
`peripheral` or `gpsd` with a TCP host, port, `max_message_bytes`, and `reconnect_s`.
The [peripheral interface](docs/runtime.md#reporting-only-equipment) carries GPS
samples, detector Observations, and captured files.
`safe_action` is the built-in failsafe response. `control_tick_s` sets the
control-loop interval. `log_queue_limit` bounds each local diagnostic and evidence-write queue, and ordinary pre-registration reports.
The [runtime queue policy](docs/runtime.md#control-loop-failure-containment-and-queue-bounds) defines which reports are protected from this limit.
The app uses Protocol's validator for all shared values.

The command registry in `src/commands.ts` owns executable kinds, preparation,
vehicle steps, observed progress, and failsafe eligibility. Each listed executable
command requires a `completion_tolerances` object with `horizontal_m`, `altitude_m`,
and `stopped_mps`, and a positive `command_timeouts` value in seconds.
Fail-safe activates a policy response and has no execution entry or movement
configuration. A reporting-only Asset needs neither movement configuration nor
initial settings. Movement also requires the Hold tolerance and timeout even when
Hold is not advertised, because handback and command failures use it internally.
A critical battery rule also requires Return-to-home tolerances and timeout for
its fixed fallback, even when Return to home is not advertised.
Acquisition-only `gpsd` and `peripheral` equipment cannot advertise movement commands.
The configured safe action is unused when no commands are listed.

## Options

| Option | Purpose | Notes |
| --- | --- | --- |
| `asset_key` | Core credential for IP | An admin [provisions the key](../core/docs/api.md#accounts-and-provisioning) |
| `link.core_url` | Core URL | For IP through the SDK |
| `link.kind` | Fieldlink selection | Use `meshtastic` and omit `asset_key` and `link.core_url` |
| `link.port` | Local Meshtastic radio serial port | Required for Meshtastic |
| `link.python` | Python with the Meshtastic client installed | Defaults to `python3` |
| `link.gateway` | Gateway radio's public key | Required for Meshtastic as 64 lowercase hexadecimal characters with at least one nonzero digit |
| `link.discovery_channel` | Radio slot for the shared private channel | Integer from 0 through 7, default 0 |
| `description` | Protocol registration body | Lists reports, commands, settings, cameras, and subsystems supported by this configuration |
| `equipment` | Equipment kind and connection | Options for each kind are listed above |
| `initial_settings` | Starting live settings | Explicit home precedes automatic home; includes the configured failsafe policy |
| `safe_action` | Built-in failsafe response | Used when Fail-safe finds no applicable configured rule |
| `completion_tolerances`, `command_timeouts` | Completion limits and timeout seconds per command | Required for listed executable commands |
| `default_ground_speed_mps` | Speed when none is requested | Required for movement; nonnegative and at most the maximum |
| `max_ground_speed_mps` | Maximum horizontal speed | Required for movement; positive; [faster requests are capped](docs/README.md#move-to-speed) |
| `measurement_stale_after_s` | Maximum measurement age | Required positive seconds |
| `final_report_wait_s` | Final acknowledgement wait | Required nonnegative seconds |
| `control_tick_s` | Control interval | Required positive seconds |
| `reporting.heartbeat_s` | Report heartbeat interval | Required positive seconds |
| `log_level` | Diagnostic detail | Required `trace`, `debug`, `info`, `warn`, or `error` |
| `log_directory` | Local operation records | Works while Core is unreachable |
| `log_message_content` | Trace request and report bodies | Required boolean; credentials removed |
| `log_queue_limit` | Diagnostic, evidence-write, and ordinary pre-registration report capacity | Required positive integer |
| `log_file_limit_bytes`, `log_total_limit_bytes` | Diagnostic rotation and total limits | Required positive integers; starting points 64 MiB per file and 2 GiB per operation, about 17 hours at full detail (estimated from SITL runs at about 115 MB an hour); overflow becomes [gap evidence](docs/logging.md#when-logging-cannot-keep-up) |
| `archive_directory` | [Reset ZIP](docs/logging.md#export-the-assets-reset-zip) destination | Copied off by hand; the app never deletes archives |

See [Meshtastic Fieldlink](../fieldlink/meshtastic/README.md) for gateway and
radio setup. Use the same `inspect` and `run` commands for a Meshtastic Asset.

ArduPilot equipment also accepts `stream_rate_hz`, an integer from 1 through
65535 for the requested telemetry stream rate, default 5 Hz, and
`extended_state_interval_us`, an integer from 1 through 2147483647 for the
requested EXTENDED_SYS_STATE interval, default 200000 microseconds. Inspection
shows these defaults when omitted. These are requested cadences; the controller
may deliver samples at a different rate.

Equipment-specific options belong with their equipment driver or module.
[Failsafes](docs/failsafes.md) owns the failsafe policy, and
[logging](docs/logging.md) owns what is recorded.

## Open

- Secret storage and editing tools.
- Whether any configuration can change during an operation.
- How movement profiles are selected and switched.
