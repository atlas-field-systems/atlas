# Command failures and failsafes

The Asset app evaluates equipment, contact, and work state locally. It controls
the response, and reports and logs the trigger, the selected rule, and the
observed outcome. Contact comes from the [communications module](communications.md#contact).
No Asset runtime is built yet. Terms are in the [Atlas glossary](../../GLOSSARY.md).

## No rules are enabled by default

An Asset starts with no Atlas failsafe rules, battery rules included. Rules and
their responses are configured explicitly for the Asset and the operation, using
only actions the Asset supports. A reporting-only beacon has no failsafe.

An empty rule list leaves the flight controller's own protections unchanged;
those belong to the [platform setup](#independent-flight-controller-protections).
[Subsystem conditions](status.md) describe equipment. Reporting a condition does
not gate commands, cancel work, or select a response; only configured rules do.

## A failed command cancels the remaining Tasks

A failed command always cancels the remaining Tasks, whatever the failsafe
configuration, because later work may depend on it. The Asset reports the
failure and each cancelled Task. The failed Task stays failed, and cancelled work
never returns through a repeated event or a reconnect. Another attempt needs new
Tasks.

The Asset raises its `clear_count` each time it clears its queue, for a failed
command or a failsafe. A Task that Core accepted before it knew of the clear
carries the old count, and the Asset reports that Task `cancelled` when it
arrives.

Cancellation alone does not enter failsafe state or start a maneuver. An Atlas
response starts only when a configured rule matches.

## Independent flight-controller protections

The quadcopter needs flight-controller protections that work if the Asset app or
companion computer fails. Atlas rules cannot act when their process has stopped
or hung. The flight setup selects which conditions Atlas handles and which
ArduPilot handles on its own, and can rely on ArduPilot's return to home,
including for loss of Asset-app control. Enabling it does not prove a successful
return or landing.

When the app detects an independent autopilot failsafe taking over, it cancels
ordinary work and the remaining queue and enters
[failsafe state](#lock-ordinary-work-for-the-rest-of-the-operation). It never
overrides that protection with ordinary work. A cancelled Task does not become
completed because the autopilot performed a similar maneuver. The app records
the equipment behavior and affected Task outcomes without claiming that Atlas
started the maneuver. If the app fails, its reports and logs may be missing, and
a missing report establishes no outcome.

In the [ground-Pi setup](assets.md#ardupilot-quadcopter), losing the link
to Core and losing the SiK equipment link are independent failures. The
app can stay reachable with no current vehicle measurements or control, and it
cannot send a response through a lost equipment link. The flight setup defines
the vehicle's own response and the operator's intervention path; both must work
without the ground app.

Before the first copter flight, document the retained autopilot protections and
how Atlas commands interact with them. Verify the interaction in
[SITL and equipment checks](testing.md), including an Asset-app crash or hang,
loss of the companion-to-controller link, and an autopilot intervention during
work or during an Atlas response.

## Configure conditions as well as responses

Each rule requires all its conditions to hold. Alternative combinations are
separate rules, with an explicit priority order, and the highest-priority
matching rule selects the response. Battery rules are configured like the rest;
none has an implicit priority.

Conditions can include:

- Equipment faults, battery thresholds, and contact loss, alone or combined.
- No Tasks for a configured duration, including zero: neither an active Task nor
  a queued Task that can start. A paused mission with queued Tasks is not idle.
  A queued Task that waits for a Task the Asset has not received is not work, so
  an Asset that holds only such Tasks is idle. Telemetry does not reset the
  timer. Each new idle interval starts fresh.
- Being airborne, for example combined with contact loss and no remaining work.
- Being outside a supplied horizontal polygon, even without an observed
  crossing, including at startup or after a policy replacement. A distance
  beyond the boundary and a duration outside are configured; either may be zero.
  Altitude limits are deferred.
- Missing or stale measurements, distinct from current values. Unknown position
  proves neither inside nor outside the polygon; separate missing-data conditions
  can select a response.

The Asset reevaluates whenever relevant state or time changes, including when the
last Task ends while it is already out of contact. Rules apply from startup, as
soon as the Asset can evaluate them, with no implicit ground exemption; include
an airborne condition when that is the intended scope.

## A failsafe activates a configured Task

Activation overrides ordinary work and pause, stops current work, and clears the
remaining Tasks. The Asset starts the configured response locally, through the
same module used for ordinary work. Each execution is its own Task with a
reported outcome. Parameters are fixed when it starts: a response that uses home
resolves home at activation and keeps that destination.

A higher-priority matching rule interrupts the response. The Asset reports the
interrupted Task `cancelled` and starts a new Task for the new rule. Priority
only rises for the rest of the operation, including after a response completes.
Equal- or lower-priority matches never start another response.

Each rule gets at most one primary attempt and one optional fallback Task, using
the same executor. A failed primary starts the fallback once, and each failure is
reported. No response restarts or triggers itself. After both fail, the Asset
stays in failsafe state and records the actual equipment state; failed attempts
do not establish a landing. A higher-priority rule may still act.

## Lock ordinary work for the rest of the operation

Failsafe state lasts for the rest of the operation, including after a successful
landing, renewed contact, or conditions becoming false. Cancelled Tasks never
resume. Reports and logging continue.

In failsafe state the operator can still override the response:

- **Land or Return to home now.** A Land or Return to home Task sent with `now`
  replaces the response Task, which is reported `cancelled`.
- **Pause to hold.** Pause holds the vehicle, and setting it running again ends
  the hold, as [outside a failsafe](README.md#pause).

The Asset carries out an override through the same execution as ordinary work
and records it as an override in its failsafe report and log. It refuses
everything else that affects execution: other Tasks, cancel,
other settings changes, and policy replacement. A refused Task is reported
`failed`, with the failsafe as its explanation. A refused cancel or settings
change is answered with the current Task state or settings, naming the request.

Failsafe state has no exit. When a response or an override ends with the Asset
safely stopped, such as a completed landing, the app sends its final reports and
shuts itself down. Core then shows the Asset offline, as it would after lost
contact, and the other Assets keep working. Atlas has no remote restart and no
way to clear the state.

## Replace the policy during ordinary operation

Outside failsafe state, operators can replace the complete policy. The Asset
validates its actions, parameters, conditions, and priorities together before
applying it, and keeps the old policy if any part is invalid. A replacement takes
effect at once against existing measurements and elapsed times, without
restarting idle or contact timers.

## Open

- Flight-controller protection settings, triggers, timeouts, and the handover
  procedure, including behavior after both the primary and fallback fail.
- Whether an operator override reaches the vehicle while an independent
  autopilot protection is in control.
- How a later, higher-priority rule match interacts with an operator override.
- Exact detection of an autopilot takeover and its interaction with a running
  Atlas response.
- Boundary details and measurement freshness limits.
- What counts as safely stopped on each platform, and how long the app waits for
  Core to acknowledge its final reports before it shuts down.
- Shared records for the failsafe policy, the identity of locally started Tasks
  (Core assigns every other `task_id`), and override reporting
  ([open questions](../../protocol/docs/open-questions.md)).
