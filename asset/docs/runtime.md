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
