# Subsystem conditions

Selected behavior, not implemented. The Asset chooses the subsystems it reports.
Protocol's current `report.status` kind `asset` has one overall condition and
cannot yet express this model. The [shared contract remains open](../../protocol/docs/open-questions.md#unresolved).

## Stable identities and shared meanings

An Asset defines a stable set of subsystem identities for its operation, with
IDs following [Atlas ID rules](../../atlas/CHARTER.md#keep-shared-data-simple)
and readable labels. Its set can include configured equipment that has not
responded yet. Atlas does not prescribe a global subsystem catalog.
A subsystem can describe hardware or equipment software, such as a GPS receiver,
flight controller, gimbal, camera, or detector.

The Asset maps equipment diagnostics into these shared conditions.
An optional explanation describes the limitation or fault.

| Condition | Meaning |
| --- | --- |
| `unknown` | Insufficient current evidence to determine the subsystem's condition, including during startup. |
| `healthy` | Operating normally. |
| `degraded` | Operating with a known limitation. |
| `faulted` | Unable to perform its intended function. |

Subsystem conditions replace the single overall Asset condition. Atlas does not
compute an overall verdict from them. The exact shared representation, bounds,
and declaration of subsystem identities are not selected yet. Shared reports
remain defined data, not arbitrary vendor status fields or codes.

## Report relevant changes

The Asset chooses when a condition is relevant to send. A report can update only
some subsystems. There is no mandatory complete snapshot on connection or
periodic health broadcast. When a reported fault or degradation clears, report
the resulting condition so the previously reported problem can clear.

Core retains each subsystem's last reported condition and its source report.
An omitted subsystem is unchanged. A subsystem with no reported condition is
unreported, not implicitly healthy. Retained reports remain last known evidence;
silence proves neither continued health nor a fresh measurement. Core and
interfaces preserve that distinction without requiring extra subsystem traffic.
[Protocol storage](../../protocol/docs/storage.md) owns the exact retained data.

## Reports describe equipment

A health label does not block commands, cancel Tasks, or cause a maneuver.
Configured [failsafe conditions](failsafes.md) own responses to equipment faults.
An unrelated camera fault does not itself prevent the vehicle from moving or
landing.

Actual execution still depends on current equipment evidence. An action can
fail when required equipment is unavailable or does not perform the action.
That is an execution failure, not a decision made by the health-reporting system.
The existing command-failure and failsafe rules still apply.
