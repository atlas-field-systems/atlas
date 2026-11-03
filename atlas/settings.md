# Settings

A setting is an Asset's current configuration, such as its lights, landing gear,
or what it does when it loses its radio link. Changing one is quick and immediate.
It does not wait in a queue or go through a Task's steps.

- Operators can change an Asset's settings, and so can the Asset itself.
  An Asset changes its own setting without asking Core, then reports the change.
- If two changes cross, the one made most recently wins, judged by when it was
  made, not when Core received it. Mesh messages can arrive late or out of order.
- A change always names the end state, such as "lights on" or "gear down",
  never "switch the gear". A late or repeated change cannot flip it the wrong way.
- A Change Setting Task puts a setting change in the queue, for example:
  fly here, lights on, fly there.
- Pause and Resume are settings, not Tasks. An Asset is set to "paused" or
  "running", always as an explicit end state.
- A Change Setting Task can pause an Asset inside a queue. It waits there until
  someone resumes it, for example: fly here, pause, wait for the operator, continue.
- A failure overrides any setting, including paused, and sends the Asset home.

How an Asset responds when something goes wrong is in [First flight](first-flight.md#when-something-goes-wrong).

[Using Atlas](using-atlas.md)
