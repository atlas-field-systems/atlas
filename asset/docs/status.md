# Subsystem conditions

Selected behavior, not implemented. The Asset chooses which subsystems it
reports and when. Protocol defines the
[subsystem report](../../protocol/docs/decisions.md#reports).

## Stable identities and shared meanings

An Asset defines a stable set of up to 16 subsystems for its operation, with IDs following
[Atlas ID rules](../../atlas/CHARTER.md#keep-shared-data-simple) and readable
labels, and declares them in its description. The set can include configured equipment that has not responded yet.
Atlas has no global subsystem catalog. A subsystem can be hardware or equipment
software, such as a GPS receiver, flight controller, gimbal, camera, or detector.

The Asset maps equipment diagnostics onto shared conditions, with an optional
explanation of the limitation or fault.

| Condition | Meaning |
| --- | --- |
| `unknown` | Not enough current evidence to tell, including during startup |
| `healthy` | Operating normally |
| `degraded` | Operating with a known limitation |
| `faulted` | Unable to perform its intended function |

There is no overall Asset condition, and Atlas computes no overall verdict from
subsystems. Reports carry these defined conditions, not vendor status codes.

## Report relevant changes

The Asset sends a condition when it is relevant. Each report updates one
subsystem, and one batch can carry several. There is no mandatory snapshot on connect and no periodic health
broadcast. When a fault or degradation clears, the Asset reports the new
condition so the earlier problem clears too.

Core keeps each subsystem's last reported condition. An omitted subsystem is
unchanged, and a declared subsystem never reported is unreported, not healthy. A kept
condition is last known evidence; silence proves neither continued health nor a
fresh measurement.

## Reports describe equipment

A condition does not block commands, cancel Tasks, or cause a maneuver.
Only a configured [failsafe condition](failsafes.md#configure-conditions-as-well-as-responses)
that names a subsystem responds to its condition. An
unrelated camera fault does not stop the vehicle from moving or landing.
Execution still depends on current equipment: an action fails when required
equipment is unavailable or does not perform it, and the
[command-failure rule](failsafes.md#a-failed-command-cancels-the-remaining-tasks)
applies.

## Inspect local diagnostics on demand

Local inspection shows module and equipment diagnostics, such as connection
details, queue use, and sensor-worker state. It keeps individual conditions and
explanations without an overall verdict; a running process does not show that
its equipment works. Inspection complements [local logging](logging.md) and
needs no remote command.

## Open

- The local inspection interface.
