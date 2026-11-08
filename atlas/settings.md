# Settings

A setting is an Asset's current configuration, such as its lights, landing gear,
or what it does when it loses its radio link. Changing one is quick and immediate.
It does not wait in a queue or go through a Task's steps.

- Operators can change an Asset's settings, and so can the Asset itself.
  An Asset changes its own setting without asking Core, then reports the change.
- The Asset applies new immediate changes in the order it receives them, alongside
  its own local changes. It does not compare the operator's clock with its own.
  A delayed distinct command can therefore override a local change made later
  than that command was sent.
- A change always names the end state, such as "lights on" or "gear down",
  never "switch the gear". A retry of the same message is not applied again.
- A Change Setting Task puts a setting change in the queue, for example:
  fly here, lights on, fly there. It applies when that Task runs, regardless of
  when its body was sent or received.
- Pause and Resume are settings, not Tasks. An Asset is set to "paused" or
  "running", always as an explicit end state.
- Pause affects movement already underway. The Asset owns the
  [platform-specific response](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#pause).
- A Change Setting Task can pause an Asset inside a queue. It waits there until
  someone resumes it, for example: fly here, pause, wait for the operator, continue.
- An applicable failsafe overrides ordinary settings, including paused, and the
  Asset carries out its configured safe response. The Asset owns
  [the trigger conditions](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md).
- Settings support is independent of current values. An Asset may support no
  live settings.
- Home is a setting for Assets whose behavior uses it. The quadcopter establishes
  home under its
  [startup rules](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md#position-and-home).
  An operator can move home. A
  [failsafe response Task](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md#a-failsafe-activates-a-configured-task)
  resolves home when it starts and keeps that destination for its execution.
  There is no separate backup landing-point setting.

How an Asset responds when something goes wrong is in [First flight](first-flight.md#when-something-goes-wrong).

Normal use is an operator choosing actions such as Takeoff, Move To, and Land,
like issuing orders in an RTS game, rather than streaming high-rate controls.
The Asset reports each resulting setting value. Core and interfaces follow those
reports, not guesses based on which operator command was sent last.

[Using Atlas](using-atlas.md)
