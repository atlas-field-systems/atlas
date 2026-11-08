# Command failures and failsafes

An Asset decides locally when a safe response is needed, including while its
Core link is down. The SDK supplies contact and queue information; the Asset app
evaluates that information alongside equipment state and controls the equipment.
This is selected behavior for documentation, not an implemented runtime.

The selected response-Task model supersedes the earlier fixed-response proposal.
Exact shared formats and platform-specific details remain follow-up work.
Terms are defined in the [Atlas glossary](../../GLOSSARY.md).

## No rules are enabled by default

An Asset starts with no Atlas failsafe rules. Rules are added explicitly for
that Asset and operation; battery, contact loss, idle time, and area conditions
are not implicit defaults. A battery rule may be configured independently or
combined with other conditions, and its priority is configured too.

A reporting-only beacon has no failsafe. It can report battery and position
without supporting a response Task. Only configure response actions the Asset
can perform. Equipment-level protections belong to that platform's setup.

## A failed command cancels the remaining Tasks

If a command fails, the Asset cancels every remaining Task. This rule always
applies, regardless of its configured failsafe response. Later Tasks may depend
on the failed command, so the Asset never advances to them automatically.

For a queued command, report that Task failed with an explanation, report the
remaining Tasks cancelled, and report the empty queue. The failed Task stays
failed. Queue clearing follows
[Protocol's queue rules](../../protocol/docs/communication.md#delivering-a-task-queue),
so an old list or reconnect cannot restore the cancelled work.

For example, if Takeoff fails because physical arming is unavailable, Move To
and Land are cancelled. Enabling the physical switch later does not restart
the mission. Another attempt needs new Tasks.

Cancellation and equipment response are separate decisions. Cancelling the list
does not itself land or hold an aircraft. A configured matching rule can also
activate a failsafe task. With no matching rule, command failure still cancels the
remaining Tasks, but does not implicitly activate failsafe state. No response can
preserve or restart Tasks cancelled because a command failed.

## A failsafe activates a configured Task

Configure a supported Task as the response, including its action parameters.
When a failsafe activates, the Asset stops the
current work, clears the remaining Tasks, and starts that response locally. It
does not accept new work commands while completing the failsafe task.

The response uses the same equipment execution path as an ordinary Task. There
is no separate implementation of return home or landing just for failsafes.
A response can carry a configured destination, such as a particular landing or
return position, rather than being limited to an action name. Fixed-wing landing
is a future example; this discussion does not define that command now.

The configured response is reusable. Each activation creates a fresh Task instance
with its own identity and reported outcome. A Task ID is never reused for another
execution. Onboard identity allocation and the reports needed to tell Core about
that Task remain open contract questions.

Response parameters are fixed when the Task starts. Explicitly configured
coordinates stay fixed. If the response uses current home, resolve that position
at activation and retain it for that execution; later local setting changes do
not redirect the running Task.

Executing the response as ordinary work tests the maneuver. It does not establish
that failsafe detection, cancellation, takeover, or command blocking works.

## Configure conditions as well as responses

Failsafe conditions can be combined, such as low battery and no contact together.
The list can grow as new situations are identified. The response Task and its
parameters are configurable for the Asset. Combination syntax, exact option names,
and shared formats are not selected yet. Every rule requires all its
conditions to hold. Alternative combinations are separate rules. Rules have an
explicit priority order; if several match, only the highest-priority matching
rule starts a response Task.

If a higher-priority rule becomes true during a response, it interrupts that Task.
The interrupted Task is reported cancelled and a fresh Task starts for the new
rule. Equal- and lower-priority matches do not interrupt it.

Priority can only escalate for the rest of the operation, including after a
response completes. Each rule gets at most one primary attempt and its configured
fallback. The same or a lower-priority condition cannot start another response
afterward; a higher-priority rule can still act. This prevents an idle-zero rule
from repeatedly starting Tasks after landing.

The current cases are:

- **Command failure.** Always cancels the remaining Tasks. The equipment response
  depends on the failure and platform.
- **Battery.** Configure battery thresholds independently or as part of
  combinations. A critical-battery rule is an explicit policy choice, including
  its conditions, response Task, and priority.
- **Out of contact during work.** Losing contact alone need not trigger a
  failsafe. An Asset can continue its onboard mission without Core when configured
  to do so.
- **Out of contact while airborne with no work left.** A drone has no active
  command, its queue is empty, and it is still airborne. This condition can trigger
  a configured safe response rather than leave it hovering with no way to receive
  its next instruction. It must also be possible to configure an intentional
  wait, such as flying somewhere before the operator brings the link to it.
- **No Tasks for a configured duration.** Zero is allowed for an immediate
  condition, as are longer durations chosen for the operation. No Tasks means no
  active Task and no queued Tasks; the timer starts when both become true. A
  completed Move To followed by hovering is idle. A paused mission with queued
  Tasks is not idle. Telemetry traffic does not reset the timer. Only an active
  Task or a complete, accepted queue stops the timer. Fragments of a proposed list
  do not establish executable work; an incomplete replacement leaves any current
  accepted work in effect. The next time there is no active Task and no accepted
  queued work, a fresh idle interval starts.
- **Leaving a configured area.** Supply a horizontal polygon directly as
  coordinates, reusing [Protocol's area representation](../../protocol/definitions/components/area.json).
  Altitude restrictions are deferred. The Asset does not retrieve a geofeature
  from Core to evaluate the condition. Being outside can trigger the rule even
  without an observed inside-to-outside crossing, including when starting outside
  or applying a polygon that excludes the current position. Configure a distance
  beyond the boundary and a duration outside before triggering; both may be zero.

Unavailable or stale measurements are distinct from current measured values.
For example, unavailable position does not establish that the Asset is inside
the polygon. Separate configurable missing-data conditions can select a response.
Exact freshness limits and condition reporting remain open.

The app reevaluates the conditions as its state changes. If contact was already
lost during a mission, finishing the last Task can make the airborne-idle
condition true without another link-loss event.

Configured rules apply before the first Task, as soon as the Asset can evaluate
them. There is no implicit startup or ground exemption. Include an airborne
condition when that is the intended scope. An idle-zero rule without such a
condition can activate and lock the Asset at startup.

An applicable failsafe overrides ordinary work and pause. Under the response-Task
direction, activation clears existing work rather than using continue as a
failsafe action. Continuing a mission without contact is expressed by conditions
that do not activate a failsafe in that situation. The Asset reports and
[logs](logging.md) the trigger, response, and observed result. Core follows the
reported outcomes rather than assuming that an offline Asset stopped working.

## Try one configured fallback if the response fails

A response may configure one fallback Task using the same equipment executor.
If the primary Task fails, report it failed and try the fallback once. If the
fallback also fails, report that failure and remain in failsafe state. There is
no automatic restart of the same failed response or recursive trigger loop.
The primary Task and one fallback are the limit of Atlas's automatic attempts
for that rule. Keep recording actual equipment state after both fail. Each
platform documents what equipment or autopilot protections remain; failed
attempts do not establish a successful landing. A higher-priority rule can still
act under the escalation rule.

## Lock ordinary work for the rest of the operation

Failsafe state refuses remote motion commands, queue replacements, Cancel, Pause,
and settings changes that affect execution. Queries and reports continue. The
Asset keeps this state for the rest of the operation, including after the response
Task completes successfully. Conditions becoming false, renewed contact, or a
successful landing do not unlock ordinary work. Cancelled Tasks never resume.

There is no in-operation recovery or clear-failsafe request in scope. The intended
next step is shutdown and inspection of the local logs. Recovery after a process
restart is already outside Atlas's operating assumptions; a restart is not a
specified way to resume this operation. Current Protocol's unconditional Cancel
and immediate-command rules do not yet express the failsafe lock.

## Replace configuration during ordinary operation

Operators can replace the complete failsafe configuration live during ordinary
operation. Validate the replacement together, including supported response actions,
parameters, conditions, and priorities. Reject an invalid replacement and retain
the previous configuration. This does not permit ordinary execution-affecting
edits after failsafe activation, and there is no recovery-edit exception.

An accepted replacement immediately evaluates the existing measurements and
elapsed times. Replacing configuration does not restart the idle or contact
timers. For example, changing the idle threshold from ten minutes to one minute
after five minutes idle makes that condition true immediately.

## Later specification work

- Additional equipment failures and response choices as new scenarios arise.
- Platform-specific equipment behavior when both response attempts fail.
- Boundary details and unavailable-data freshness limits.
- Onboard Task identities and how Core learns about work created while disconnected.
- Shared settings and reports. Current Protocol definitions describe unconditional
  link loss and a fixed response enum. They do not yet describe combined
  conditions, configured response Tasks, or a command lock.
