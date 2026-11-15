# Asset runtime

The [behavior](README.md) and [failsafes](failsafes.md) pages own product rules.
This page describes their implementation.

The runtime stores the phase separately from the active execution and operator
override. Each execution tracks suspended time, which does not consume its
command timeout. Repeating the current run state does not reissue movement. A
critical fallback keeps the failed response's rule and priority and is marked
as a fallback, so a later failure cannot start another return. Command failure
and timeout replace the failed maneuver with a hold unless a critical fallback
starts instead. These are runtime mechanisms for the outcomes above.

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
remains valid until the requested mode is observed. An unrelated mode still
shows takeover immediately. A different mode while armed gives control to the flight controller.
Guided mode hands control back. Handback samples rules, starts a tracked Hold,
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
when that execution ends. Failure does not sample or re-arm rules. Whether such
failure should re-arm protection like Hold remains an owner question.

The equipment driver has one abortable command generation. A replacement aborts
the prior generation. Command ACKs are ignored until that invocation's write
completes. Cancellation is checked before mode and acknowledged command writes
and after their acknowledgements. MAVLink ACKs carry a command ID but no
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
An immediate settings Task ends the superseded execution and holds movement
before applying its settings.
Settings answers are reducer effects, including retained settings on refusal,
so the IP adapter sends the decision with the request ID.

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
