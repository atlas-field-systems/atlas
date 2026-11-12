# Command failures and failsafes

The Asset app evaluates equipment, contact, and work state locally. It controls
the response, and reports and logs the trigger, the selected rule, and the
observed outcome. Contact comes from the [communications module](communications.md#contact).
No Asset runtime is built yet. Terms are in the [Atlas glossary](../../GLOSSARY.md).

## No rules are enabled by default

Atlas enables no failsafe rules by itself. Rules and their responses are
configured explicitly for the Asset and the operation, using only actions the
Asset supports. A reporting-only beacon has no failsafe. The one built-in
response is the safe action its maker chose, used when an operator
[fires the failsafe](#an-operator-can-fire-the-failsafe) and no rule applies.

**Every flying Asset needs a critical battery rule.** A flying Asset is one
that lists `takeoff` among its commands. Its policy must hold at least one rule
with a [critical battery condition](#an-override-with-hold-or-pause-re-arms-protection),
usually from its configuration. Core refuses Tasks to a flying Asset whose
reported policy has none, and refuses a settings change that would replace its
policy with one that has none
([operator requests](../../core/docs/api.md#operator-requests)).

The rules form the Asset's failsafe policy: one setting, `failsafe_policy`, with
up to 16 rules. Its starting value comes from the Asset's
[configuration](../config.md), and any operator can replace it as they change
other settings. Each response is a command the Asset supports, such as Land,
Return to home, or Hold. A response is always protective. Atlas has no
"continue" response: a situation the Asset should keep working through is not a
failsafe, so the Asset has no rule for it. [Protocol](../../protocol/docs/decisions.md#failsafes) defines the
records.

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
ArduPilot handles on its own. Enabling a protection does not prove a successful
return or landing.

**Required for flying Assets: the flight controller returns home on its own
when it loses the Asset app.** The flight controller runs its own failsafe, such
as return to home, when it stops hearing from the computer that runs the Asset
app, without Atlas. This covers an app crash, a hang, a failed companion
computer, and a lost companion-to-controller link. On ArduPilot this is the
[ground station (GCS) failsafe](https://ardupilot.org/copter/docs/gcs-failsafe.html),
which watches MAVLink heartbeats:

- The app sends MAVLink heartbeats from its control loop with the system ID
  that ArduPilot counts as its ground station (`MAV_GCS_SYSID`, called
  `SYSID_MYGCS` in older firmware). A hung app then stops them too.
- `FS_GCS_ENABLE` selects the response, for example RTL, which lands instead
  when GPS is not usable, and `FS_GCS_TIMEOUT` sets how long without a
  heartbeat triggers it.
- The setup leaves off the `FS_OPTIONS` choices that continue an Auto mission
  or pilot control on a GCS failsafe.
- Nothing else may send heartbeats with that system ID: not a ground station
  program, a MAVLink router, or MAVProxy on the same computer. Their
  heartbeats would keep the failsafe from firing.

ArduPilot's own rules still apply: the failsafe stays inactive until the first
heartbeat arrives, does nothing while disarmed, disarms a copter that has
landed, and leaves the vehicle in the failsafe mode when heartbeats return.

When the app detects an independent autopilot failsafe taking over, it cancels
ordinary work and the remaining queue and enters
[failsafe state](#lock-ordinary-work-for-the-rest-of-the-operation). Its failsafe
report says the flight controller took over, not an Atlas rule. It never
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

- A declared [subsystem](status.md) reporting degraded or faulted, as the rule
  chooses. A rule set off by degraded also counts faulted.
- The battery below a set percentage. Atlas does not estimate the charge needed
  to get home: by the time that estimate fires, heading home is already late.
- The battery below a critical level, set below the other battery rules. A
  critical battery rule
  [always fires](#an-override-with-hold-or-pause-re-arms-protection).
- The operator's [Fail-safe command](#an-operator-can-fire-the-failsafe).
- Contact loss, after the `link_loss_after_s` setting without contact.
- Any of these, alone or combined.
- No Tasks for a configured duration, including zero: neither an active Task nor
  a queued Task that can start. A paused mission with queued Tasks is not idle.
  A queued Task that waits for a Task the Asset has not received is not work, so
  an Asset that holds only such Tasks is idle. Telemetry does not reset the
  timer. Each new idle interval starts fresh.
- Being airborne, for example combined with contact loss and no remaining work.
- Being outside a horizontal polygon drawn in the rule itself, never taken
  from a saved place, even without an observed crossing, including at startup
  or after a policy replacement. A distance
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
resolves home at activation and keeps that destination, and a Land with no
position lands where the Asset is at activation.

A failsafe Task has no Core `task_id`, because Core owns that numbering. Its rule
and attempt, primary or fallback, and its start time name it; the built-in safe
action has no rule. The Asset reports its state in a failsafe report, starting
with the response it runs and what set it off.

A higher-priority matching rule interrupts the response. The Asset reports the
interrupted Task `cancelled` and starts a new Task for the new rule. Priority
only rises for the rest of the operation, including after a response completes.
Equal- or lower-priority matches never start another response, except after
[an override that re-arms protection](#an-override-with-hold-or-pause-re-arms-protection).

Each time a rule fires it gets one primary attempt and one optional fallback
Task, using the same executor. A failed primary starts the fallback once, and
each failure is reported. No response restarts or triggers itself. After both fail, the Asset
stays in failsafe state and records the actual equipment state; failed attempts
do not establish a landing. A higher-priority rule may still act.

## Lock ordinary work for the rest of the operation

Failsafe state lasts for the rest of the operation, including after a successful
landing, renewed contact, or conditions becoming false. Losing contact again
never restarts an equal- or lower-priority response, unless an operator has
[re-armed protection](#an-override-with-hold-or-pause-re-arms-protection).
Higher-priority matches follow the
[existing priority rule](#a-failsafe-activates-a-configured-task).
Cancelled Tasks never resume. Reports and logging continue.

In failsafe state the operator can still override the response:

- **Land, Return to home, or Hold now.** One of these Tasks sent with `now`
  replaces the response Task, which is reported `cancelled`. Hold is an ordinary
  command here, as Land is.
- **Pause and run.** Pausing stops movement in place and keeps the response
  Task active; setting the Asset running again continues it, as
  [outside a failsafe](README.md#pause). Pause is a setting, not Hold.

The Asset carries out an override through the same execution as ordinary work.
It records the override in its failsafe report, naming the request, and in its
log. It refuses everything else that affects execution: other Tasks, cancel,
other settings changes, and policy replacement. A refused Task is reported
`failed`, with the failsafe as its explanation. A refused cancel or settings
change is answered with the current Task state or settings, naming the request.

Failsafe state has no exit. When a response or an override ends with the Asset
safely stopped, such as a completed landing, the app sends its final reports and
shuts itself down. Core then shows the Asset offline, as it would after lost
contact, and the other Assets keep working. Atlas has no remote restart and no
way to clear the state.

## An override with Hold or pause re-arms protection

Hold now and pause leave the Asset in the air with no protective maneuver
running. So when an operator overrides with either, the Asset re-arms every
rule whose conditions include contact loss or low battery. A re-armed rule
fires again, whatever its priority, when its conditions start to hold after the
override: it starts its response, which replaces the Hold or the paused
response Task. A condition that already holds at the override, such as a
battery still below the rule's percentage, fires again only after it stops
holding and holds again. The Asset stays in failsafe state throughout; re-arming
never cancels it. A Land or Return to home override re-arms nothing.

**A critical battery level always fires.** A rule whose battery condition is
marked critical fires whenever the battery is below that level, whatever its
priority and whether or not it fired before. A Hold now or pause override never
keeps it from acting: the rule fires again at once, replacing the Hold or the
pause, so a held Asset can't hover until its battery dies. Land and Return to
home overrides still stand. The overrides themselves are unchanged.

**The highest-priority critical rule wins.** When several critical rules match
at once, only the highest-priority one fires, and a lower-priority critical
rule never interrupts its response.

**A failed critical response falls back to Return to home.** A critical rule
names no fallback of its own: if its response fails, the Asset returns home.
The Asset refuses a policy in which a critical rule names a fallback, as it
refuses any invalid policy. Nothing is retried: if the failed response was
itself Return to home, or the return home fails, the Asset stays in failsafe
state as after any [failed fallback](#a-failsafe-activates-a-configured-task).

For example, an Asset has rule `LB` (battery below 25%, Return to home,
priority 50), rule `CB1` (critical battery below 10%, Land at landing pad `P1`,
priority 80), and rule `CB2` (critical battery below 10% with contact lost,
Land where it is, priority 90):

| Event | What the Asset does |
| --- | --- |
| The battery falls below 25% | `LB` fires: Return to home |
| The operator sends Hold now | Hold replaces Return to home; `LB` is re-armed |
| The battery falls below 10%, contact still up | Only `CB1` matches: it fires at once, replacing the Hold, and heads for `P1` to land |
| The landing at `P1` fails | The Asset returns home, as `CB1`'s fallback |
| It lands at home | Final reports, then the app shuts down |

Had contact also been lost when the battery fell below 10%, `CB1` and `CB2`
would both match, and only `CB2`, the higher priority, would fire.

## An operator can fire the failsafe

Fail-safe is a command, like Land, Return to home, or Hold. An operator sends it
alone with `now`, and the Asset treats it exactly as if its failsafe had fired:
it stops current work, clears its queue, and enters failsafe state. It runs the
operator's rule for it: the highest-priority rule with the Fail-safe command
condition whose other conditions also hold. Only if no rule applies does it
fall back to the built-in safe action its maker chose. The command is what sets
the rule off; it is never a response itself. From then on it is like any
failsafe: the
state can't be cancelled or left, and the
[overrides above](#lock-ordinary-work-for-the-rest-of-the-operation) apply. The
Fail-safe Task completes once the Asset is in failsafe state; the response runs
as a failsafe Task. An Asset already in failsafe state refuses it like any
other Task.

An Asset that has failsafes lists `failsafe` among its commands. Like every
command, it reaches only an Asset that is online: Core refuses it for an offline
Asset ([operator requests](../../core/docs/api.md#operator-requests)). A vehicle
out of contact relies on its own contact-loss rules and on the
[flight controller's protections](#independent-flight-controller-protections).

## If the app fails in flight

Nothing restarts the app. If the Asset app or its companion computer fails in
the air, it stays down. Core shows the Asset offline, as after lost contact,
and the other Assets keep working. The flight controller notices that the app
is gone and returns home on its own, through the
[required protection](#independent-flight-controller-protections). The vehicle
is inspected before its next flight. A dropped link is not a failure of the
app.

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
