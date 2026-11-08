# Command failures and failsafes

The Asset app evaluates equipment, contact, and work state locally, controls the
response, and reports and logs the trigger, selected rule, and observed outcome.
The SDK supplies contact and queue information through the communications module.
No Asset runtime is built yet.
Terms are defined in the [Atlas glossary](../../GLOSSARY.md).

## No rules are enabled by default

An Asset starts with no Atlas failsafe rules, including battery rules. Rules and
response actions are configured explicitly for the Asset and operation. Only
configure actions the Asset supports. A reporting-only beacon has no failsafe.

[Subsystem conditions](status.md) describe equipment. Reporting a condition does
not gate commands, cancel work, or select a response. Configured conditions own
reactions to faults. A failed physical execution remains a command failure under
the rule below, independently of health reporting.

## A failed command cancels the remaining Tasks

A failed command always cancels the remaining Tasks, regardless of failsafe
configuration: later work may depend on it. Report the failure and cancellations
under [Protocol's queue rules](../../protocol/docs/communication.md#delivering-a-task-queue).
The failed Task remains failed, and cancelled work cannot return through an old list
or reconnect. Another attempt needs new Tasks.

Cancellation alone does not activate failsafe state or perform a maneuver.
A response starts only if a configured rule matches.

## Configure conditions as well as responses

Each rule requires all its conditions to hold. Alternative combinations are
separate rules, with an explicit priority order. The highest-priority matching
rule selects the response. Battery thresholds and priority are configured like
other rules; no battery rule has an implicit priority.

Conditions can include:

- Equipment faults, battery thresholds, and contact loss, independently or
  together with other conditions.
- No Tasks for a configured duration, including zero. This means neither an active
  Task nor a complete, accepted queue. A paused mission with queued Tasks is not
  idle. Telemetry and fragments of a proposed list do not reset the timer; an
  incomplete replacement leaves current accepted work in effect. Each new idle
  interval starts fresh.
- Being airborne, for example combined with contact loss and no remaining work.
- Being outside a supplied horizontal polygon using [Protocol's area representation](../../protocol/definitions/components/area.json).
  This applies even without an observed crossing, including at startup or after
  policy replacement. Configure a distance beyond the boundary and a duration
  outside before triggering; both may be zero. Altitude restrictions are deferred.
- Missing or stale measurements, distinguished from current measured values.
  Unavailable position proves neither inside nor outside the polygon; separate
  missing-data conditions can select a response.

Reevaluate when relevant state or time changes, including when the last Task ends
while already out of contact. Rules apply before the first Task as soon as the
Asset can evaluate them, with no implicit startup or ground exemption. Include an
airborne condition when that is the intended scope. Intentional waiting without
contact is allowed by configuring conditions that do not match that situation.

## A failsafe activates a configured Task

Activation overrides ordinary work and pause, stops current work, and clears the
remaining Tasks. The Asset locally starts the configured response through the
same module used for ordinary execution. Each execution has a fresh Task identity
and reported outcome.

Parameters are fixed at Task start, including explicit destinations. If the
response uses current home, resolve that position at activation and retain it
for the execution.

A higher-priority matching rule interrupts the response: report the interrupted
Task cancelled and start a fresh Task for the new rule. Priority can only increase
for the rest of the operation, including after response completion. Equal- or
lower-priority matches cannot start another response afterward.

Each rule gets at most one primary attempt and one optional fallback Task, using
the same executor. Primary failure starts the fallback once; report each failure.
No failed response automatically restarts or recursively triggers itself. After
both attempts fail, remain in failsafe state and record actual equipment state;
failed attempts do not establish a successful landing. A higher-priority rule may
still act.

## Lock ordinary work for the rest of the operation

Failsafe state refuses remote motion commands, queue replacements, Cancel, Pause,
and settings changes that affect execution. Queries, reports, and logging continue.
The lock lasts for the rest of the operation, including after successful landing,
renewed contact, or conditions becoming false. Cancelled Tasks never resume.
There is no in-operation recovery; shutdown and local log inspection follow.

## Replace configuration during ordinary operation

Operators can replace the complete policy during ordinary operation. Validate
supported actions, parameters, conditions, and priorities together before applying
it. Reject an invalid replacement and retain the old policy. The failsafe-state
lock prevents execution-affecting edits after activation.

Accepted replacements immediately evaluate existing measurements and elapsed
times without restarting idle or contact timers.

## Later specification work

- Platform equipment behavior after the primary and fallback both fail, including
  the autopilot's own protections.
- Boundary details and measurement freshness limits.
- [Shared contracts](../../protocol/docs/open-questions.md#unresolved) for policy
  configuration, onboard Task identities and outcomes, and command refusal.
