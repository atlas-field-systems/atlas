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
measurements received since the last control tick. It evaluates every condition even when a sibling is false. Each rule stores
one start time per condition. Idle intervals begin on the first idle sample;
contact loss uses the last heard time. Re-arming preserves condition timers.
The command registry declares whether an override re-arms protection or stands
until its execution ends. Command timeouts come directly from configuration.

Every registry step names its ArduPilot mode. The driver reports the raw
heartbeat mode. Control compares a fresh mode observed after its last command
with the mode that step commanded. A different mode while armed gives control
to the flight controller. Guided mode hands control back. Handback samples rules,
starts a tracked Hold, and ends that tick before rule selection.

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
