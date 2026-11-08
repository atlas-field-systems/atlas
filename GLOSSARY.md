# Atlas language

Terms used across Atlas. Behavior and exact shared contracts remain in their
owning subsystem docs.

## Language

**Asset**:
A participant in Atlas that reports information and may offer equipment-control
capabilities. A vehicle and its onboard camera are one Asset.
_Avoid_: Vehicle, when referring to all kinds of Asset

**Command**:
A request for an Asset to perform a supported action, such as Takeoff or Land.
_Avoid_: Task, when referring only to the requested action

**Task**:
One instance of requested work with a reported execution outcome.
_Avoid_: Command, when referring to the whole work instance

**Failsafe condition**:
A test of an Asset's equipment, contact, or work state that can contribute to
activating a failsafe.

**Failsafe task**:
A Task that an Asset starts locally as its configured response to a failsafe.
_Avoid_: Separate failsafe maneuver, when referring to the same supported action

**Failsafe response**:
The reusable description of an action and its parameters to execute when a
failsafe activates.
_Avoid_: Task instance, when referring to reusable response configuration

**Failsafe rule**:
A set of conditions that must all hold, with a priority and a configured failsafe
response.

**Failsafe state**:
The Asset's state after a failsafe activates, in which ordinary work is locked
for the rest of the operation. In-operation recovery is out of scope.
