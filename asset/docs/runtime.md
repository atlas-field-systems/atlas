# Asset runtime

The [behavior](README.md) and [failsafes](failsafes.md) pages own product rules.
This page describes their implementation.

The runtime stores the phase separately from the active execution and operator
override. Each execution tracks suspended time, which does not consume its
command timeout. Repeating the current run state does not reissue movement. A
critical fallback keeps the failed response's rule and priority and is marked
as a fallback, so a later failure cannot start another return. Command failure
and timeout share one failure path. Land failure and a Return to home failure
during its Land-mode descent never insert Hold; the
existing critical fallback still applies. The unresolved outcome for other
commands is in [failsafes](failsafes.md#open).

The runtime samples rule conditions when Hold or pause takes effect, including
measurements received since the last control tick. It evaluates every condition
even when a sibling is false. Each rule stores
one timer per condition. Idle timers reference the same operation-wide idle
interval, so adding a rule does not restart elapsed idle time. Cloning the
timing records preserves these shared references. Idle intervals begin on the
first idle sample;
contact loss uses the last heard time. Re-arming preserves condition timers.
The command registry declares whether an override re-arms protection or stands
until its execution ends. Command timeouts come directly from configuration.

Every registry step names its equipment mode. The ArduPilot driver compares
heartbeat modes with the command it received and reports whether Atlas is
`in_control`. During a commanded mode transition, the prior observed Atlas mode
remains valid until the requested mode is observed, provided the vehicle was
already armed. Arming in the previous disarmed mode does not authorize Atlas
control. An unrelated mode still
shows takeover immediately. Before the first command, only Guided counts as Atlas control while armed;
a disarmed vehicle remains eligible for Takeoff. A different mode while armed
gives control to the flight controller. The reducer enters watch-only state on
the measurement itself, before a rejected command can run failure handling.
The driver also refuses new movement commands while it reports no control.
Guided mode hands control back unless takeover aborted an unconfirmed Guided
request. In that case the driver requires a later non-Guided heartbeat followed
by Guided. The takeover heartbeat itself does not satisfy that requirement.
A late Guided confirmation alone leaves Atlas watching without commands.
Handback samples rules, starts a tracked Hold,
and ends that tick before rule selection. The app calls `Vehicle.tick(now)`;
the driver owns its heartbeat interval.

The current-state reader offers fresh samples whenever asked, with their
acquisition times. It keeps no sent flags. The IP sender consumes one change
notification per offer and waits after acknowledgement; queued reports still
wake it to drain the queue. A lost batch re-reads current state. Blocked outboxes
and session endings are logged and printed to standard error, except an
intentional session stop is only logged. Shutdown waits for the session to end,
drains diagnostics, seals the writer, then builds the ZIP using the injected
clock.

Preparation and step errors use one failure path. A place update is prepared
before replacing the execution. If preparation fails, the prior execution stays
and a diagnostic records the explanation. Land and Return to home updates keep
the original transit altitude, speed, and start time. An update during the first
altitude step stays there. An update during transit or descent restarts at the
destination step so the vehicle reaches the updated place before descending.

Land and Return to home override protection belongs to its execution and ends
when that execution ends. Pause preserves that protection on the suspended
execution and resume restores it. If a Return to home override fails and the app inserts
Hold, it samples conditions and re-arms protection as for a Hold override.
A failed critical response or its failed return fallback does not re-arm itself.

The equipment driver has one abortable command generation. A replacement aborts
the prior generation. Takeover aborts that generation immediately in the driver
and the app repeats the command-only abort when entering watch-only state.
This leaves heartbeats running. Command ACKs are ignored until that invocation's write
completes. Cancellation is checked before mode and acknowledged command writes
and after their acknowledgements, and before position and Hold target writes. MAVLink ACKs carry a command ID but no
invocation ID, so an old ACK arriving after the new write completes cannot be
distinguished from the new command's ACK.

Boundary evaluation projects polygon vertices into metres around the current
position, unwraps longitudes at the antimeridian, and uses ray casting for
containment and the nearest segment for the distance margin. Height limits
compare only matching altitude references. The existing per-condition timer
measures continuous violation; a fresh inside sample or stale position clears it.
This local plane calculation approximates distances, especially for large polygons
and near the poles; those geometries have not been checked in SITL.

Live policy replacement runs the configuration validator against the proposed
settings merged with current settings before applying any change. It checks
unique rule IDs and priorities, declared subsystem references, supported responses,
and Protocol parameter shapes. Rejection
keeps all current settings and timing records. The IP settings handler reports
those retained settings with the request ID.

Before the SDK changes queue state, its optional `QueueHost.refuse` callback
asks the Asset whether to admit the request. The Asset uses the same phase
check as execution. A refused Task ends failed immediately, without entering
the held queue or superseding earlier work. Refused cancels and updates leave
the queue unchanged. The helper answers them with current Task or queue evidence
and the request ID. Known final Task outcomes remain in memory for refused
cancel answers. Cancels accepted before Task delivery keep their original
answer even if the Asset enters failsafe state before delivery.
A settings Task validates its policy before stopping current execution. Invalid
policy ends the Task failed with the validator explanation and clears remaining
Tasks through the existing command-failure rule. A valid immediate settings
Task ends the superseded execution and holds movement before applying settings.
Activation emits settings evidence whenever it changes run state. Move To
updates prepare their new requested speed; Land and Return to home retain speed.
The reducer emits one settings effect for each applied change, including queued
Tasks and automatic home acquisition. Nested settings Tasks reuse that effect.
A settings request also receives retained settings on refusal with its request ID.
The app forwards these effects without a second tick-level settings check.

## Subsystem evidence

The ArduPilot equipment configuration maps `gps` and `flight_controller` to
declared subsystem IDs. The configuration validator rejects undeclared or
duplicate mappings. GPS_RAW_INT with a 3D fix reports healthy; without one it
reports faulted with an explanation. A flight-controller heartbeat reports
healthy for the controller's communications function. These mappings do not
claim that all vehicle equipment is healthy.

Local subsystem samples retain their driver source and acquisition time. Each
new sample refreshes local evidence for rule evaluation. A changed condition or
explanation queues a report with that sample's time, including changes acquired
before Core registration. Unchanged samples produce no condition report. The
Protocol subsystem report carries no source field; source remains in local
diagnostics. Retries retain the report's original time. Subsystem rules use the
existing per-condition timing records and measurement freshness limit.

## Equipment connection recovery

ArduPilot measurements use the app's clock when the driver decodes a received
frame. This is local acquisition time, not a synchronized flight-controller
clock or report-build time. TCP bytes already in transit can reach the app after
a proxy closes its side. Decoding those bytes supplies new local measurements;
subsequent report builds retain those acquisition times.

The ArduPilot driver retries a closed TCP connection from its normal control
tick, using the configured equipment heartbeat interval between attempts. Each
connection has a new MAVLink parser and requests telemetry streams again. Close
clears the driver's GPS validity and cached Hold position, aborts the pending
command, and records that equipment is unavailable. Existing measurements keep
their acquisition times and expire normally. Subsystem conditions become unknown
with a connection-loss explanation; a heartbeat or GPS sample supplies new evidence.

A lost equipment connection during execution takes the same failure path as a
refused command or a timeout, even after the command's ACK. A fresh disconnected
sample fails the active execution on the next control tick. Reconnection never
replays the command. The Core contact path continues independently. The flight
controller's own GCS failsafe remains enabled and may take over while the
equipment link is down. On return, the existing mode-ownership handling observes
that takeover; it does not claim that Atlas performed the vehicle's response.

## Reporting-only equipment

A reporting-only configuration lists no commands and omits supported settings.
Its initial settings are empty. It has no SDK queue. Automatic home acquisition
runs only when the description advertises home. The stationary driver publishes
the configured installation position on each control tick while the installation
remains configured.

The `peripheral` acquisition driver connects to a configured TCP host and port.
An equipment adapter supplies newline-delimited UTF-8 JSON. This local driver
format is not a Protocol record or a Fieldlink. It supports these inputs:

- `position` holds `source`, acquisition `time`, `valid`, and optional `position`.
  A GPS adapter sets `valid` only for a valid fix. Invalid fixes remove the local
  position sample and send no replacement telemetry. Core retains the last known
  position. A valid sample uses Protocol's position shape.
- `observation` holds `source` and `observation`, a Protocol Observation report
  without `asset_id`. The detector supplies the observation ID and acquisition
  time. The app supplies its registered identity. Reports keep the detector's
  time and target ID. Own position stays separate.
- `file` holds `name`, `contentType`, base64 bytes in `base64`, and optional
  `place`, a Protocol geo-feature request. Every file is written under a unique
  sanitized local name before upload. Upload uses the SDK link's `storeFile`.
  Files acquired before registration wait locally until registration completes.
  Refusal never removes a captured file. Uploaded and refused captures both go
  into `files/` in the Reset ZIP.

`max_message_bytes` bounds one input line. Invalid or oversized input closes the
connection with a diagnostic. `reconnect_s` controls the next connection attempt
from the control tick. Socket backpressure bounds acquisition during local file
writes. Uploads run separately from acquisition and control, one file at a time.
Waiting files stay on disk until the uploader reads them. Stopping closes the
socket and waits for local capture writes before sealing the archive. The app
closes the Core client before waiting for outstanding uploads, so retries do not
keep shutdown running after the final-report deadline. There is no automatic
retry of a refused file.

This adapter boundary lets GPS receivers and detectors supply their own hardware
formats without adding sensor-specific records to Atlas. The simulation runs a
TCP peripheral in place of that equipment and keeps the app, SDK, and Core real.
The `gpsd` equipment kind uses the same TCP bounds and reconnect interval. It
sends WATCH with JSON enabled and consumes TPV reports as described in the
[gpsd interface](https://gpsd.gitlab.io/gpsd/gpsd_json.html). Modes 2 and 3 with
coordinates establish position. Mode 3 can supply MSL altitude. Missing time or
device stays unknown, and a lost fix clears the local sample. Other gpsd message
classes do not change position. The tracker example uses this driver. Hardware
GPS receivers and detector hardware integrations have not been verified.

## Startup resources

Equipment acquisition and the control tick start independently of Core registration.
Configured rules can therefore select responses before Core is reachable. Local
reports wait without an Asset ID and receive Core's assigned identity when
registration succeeds. Their acquisition times stay unchanged. They do not enter
the diagnostic queue.

Startup records each acquired resource's cleanup and releases resources in reverse
order on refusal or error. It then seals diagnostics and exports the failed
startup operation. Before registration supplies an identity, its archive uses
`unregistered` in the filename. This is a local archive label, never an Asset ID.
An archive failure is printed and the local records remain.

The CLI installs signal handlers before registration. An AbortSignal stops pending
startup as well as an established app. A local failsafe that safely stops before
registration also ends startup and releases its resources. Late registration
completion cannot leave a running session behind.

## Operation evidence

Each operation uses its start time as a local directory name. `operation.json`
keeps its start, registered identity and archive destination. A background scan
exports earlier operation directories without restoring requests or reports into
the new session. Shutdown waits for that scan. An `archive-failed.json` marker
is written before archive construction and remains on failure or interruption.
Later starts skip that directory. The operator handles its retained records.

ZIP entries stream from disk using stored ZIP entries and bounded stream chunks.
Verification streams the ZIP back and checks every payload and the manifest
before final rename. The manifest inventories payloads and excludes itself.
The summary renders the local Task, failsafe, override and contact timeline.
Versions come from the installed packages. The IP runtime records no Fieldlink
version because it loads no Fieldlink.

Diagnostic levels rank trace, debug, info, warn, then error. Inputs, effects,
Observations and report contents are trace. Failures and blocked outboxes are
errors. Losses and gaps are warnings. Other events default to info. A caller can
set an explicit level. Disabling message content removes request, response,
event, effect and report bodies from diagnostics. Report history remains separate.
Credential fields and the configured Asset key are removed before persistence.

The SDK's `onReports` callback records copies before outbox transmission and when
current samples are offered. Pre-registration reports also enter local history.
This history uses a separate disk writer, independent of diagnostic filtering
and rotation. It is never replayed into a later operation. SDK diagnostic gap
counts enter the operation's gap list with their reported local time; the SDK
supplies no earlier bound for those lost events.

Recovery keeps a torn report line byte for byte and lists it as an incomplete
line in the gap evidence. It does not turn that line into a report or discard
the operation. Identity-evidence write failures are logged as gaps without
rejecting the equipment or Core control path.

## Movement execution

The initial copter driver uses Guided position targets for transit and Land mode
for descent and disarming. Land and Return to home follow their
[Protocol command definitions](../../protocol/README.md).
The app resolves the position copy supplied by Core, the Atlas home setting,
and the configured speed when execution starts. An unresolved named place fails
with an explanation. Transit uses the configured default ground speed, capped
at the configured maximum.

The command registry advances through observed altitude, destination, and landing
steps. A Land without a destination or transit altitude starts descent at once.
A transit without a specified altitude snapshots the current launch altitude.
The initial ArduPilot driver refuses altitude references it cannot execute;
it never substitutes another reference. Position targets carry the resolved
destination and transit altitude to the driver. Return to home does not select
ArduPilot RTL. The flight controller's independent RTL protection stays separate.

The ArduPilot TCP driver publishes position only with a 3D GPS fix and an
absolute horizontal position estimate from EKF. Hold uses a position target at
the measured location with zero velocity in Guided. Each equipment command
supersedes the preceding operation. Its promise waits for its own command
acknowledgements and commanded-mode heartbeat; a refusal rejects that operation.


## Control-loop failure containment and queue bounds

The control tick catches equipment tick failures, still evaluates rules and
pulls eligible work, and always schedules its next iteration unless stopped. Diagnostics contain serialization and filtering errors
at the writer boundary and count the failed record as a gap. Equipment errors
produce `control_failed` diagnostics. Logging cannot escape through dispatch
before its error handling. The reducer owns the queue-pull predicate; it permits
a pull only without an execution in ordinary, unpaused operation.

The IP handshake exposes Core's configured `stream_keepalive_s` in `/about`.
The SDK compares initial link-loss settings after connecting and before
registration, refusing a threshold at or below that interval. Equipment control
continues while the handshake is pending. Startup refusal uses the normal
resource cleanup and failed-operation archive.

`log_queue_limit` also bounds ordinary pre-registration reports and the evidence
write queue. At capacity the app evicts the oldest ordinary waiting report,
or drops the new ordinary report if only protected evidence remains. Request
answers, final Task reports, all failsafe reports (including flight-controller
takeover and handback), and non-healthy subsystem reports are protected and may
exceed the limit. Each eviction or dropped addition records a pre-registration
report gap.
It still offers each acquisition to local report history. Report-history copies
have their own gap reason when the evidence writer is full. Dropping a history
copy never removes an admitted waiting report from the app or SDK outbox.
Report history remains independent of diagnostic filtering and byte rotation.

Gap accumulation keeps one count and first-to-last interval per failure reason,
rather than queuing disk writes on every reason change. Persistence writes that
bounded set after draining and at shutdown. The intervals may include time
between separate occurrences of the same failure reason.
