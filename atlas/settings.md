# Settings

A setting is an Asset's current configuration, such as its lights, landing gear,
or what it does when it loses its radio link. A change takes effect immediately.
It does not wait in the queue or go through a Task's steps.

- Operators can change an Asset's settings, and so can the Asset itself.
  An Asset changes its own setting without asking Core, then reports the change.
- A settings change always names the end state, such as "lights on" or "gear
  down", never "switch the gear". Applying the same end state twice changes
  nothing.
- The Asset applies immediate changes in the order it receives them, alongside
  its own local changes. It does not compare the operator's clock with its own.
  A delayed change can therefore override a local change made after the operator
  sent it.
- A repeated request carries the same idempotency key, so Core records it once
  ([Core API](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#basics)).
- A settings Task puts a change in the queue, for example: fly here, lights on,
  fly there. It applies when that Task runs, regardless of when it was sent or
  received.
- Pause is a setting, not a Task. An Asset is set to "paused" or "running",
  always as an explicit end state. Hold is different: it is a command, like
  Land, and keeps no earlier Task to resume.
- Pause affects movement already underway. The Asset owns the
  [platform-specific response](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#pause).
  The Task underway stays active while held and continues on resume.
- A settings Task can pause an Asset inside a queue. It waits there until
  someone resumes it, for example: fly here, pause, wait for the operator, continue.
- The failsafe rules are one setting, the failsafe policy, always replaced
  whole. Any operator can replace it outside a failsafe.
- An applicable failsafe overrides ordinary settings, including paused, and the
  Asset carries out its configured safe response. The Asset owns
  [the trigger conditions and the operator's overrides](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md).
- Settings support is independent of current values. The Asset's description
  lists the settings it supports, and Core refuses a change to any other. An
  Asset may support no live settings.
- Home is a setting for Assets whose behavior uses it. The quadcopter establishes
  home under its
  [startup rules](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#position-and-home).
  An operator can move home. A
  [failsafe response Task](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#a-failsafe-activates-a-configured-task)
  resolves home when it starts and keeps that destination for its execution.
  There is no separate backup landing-point setting.

How an Asset responds when something goes wrong is in [First flight](first-flight.md#when-something-goes-wrong).

In normal use, an operator chooses actions such as Takeoff, Move To, and Land
rather than streaming high-rate controls.
The Asset reports each resulting setting value. Core and interfaces follow those
reports, not guesses based on which operator command was sent last.

[Using Atlas](using-atlas.md)
