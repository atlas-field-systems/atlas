# Command interface docs

Selected behavior, not implemented. Shared exchanges live in
[How Atlas parts communicate](../../protocol/docs/communication.md). The Asset
owns its [behavior](../../asset/docs/README.md) and [subsystem conditions](../../asset/docs/status.md).

## Show reported support and evidence

The interface offers the commands the Asset explicitly lists. It keeps setting
support separate from whether a current value is known. A reporting-only tracker
needs no movement controls, pause control, or artificial home.

Connection readiness does not mean equipment is ready. Show reported subsystem
conditions individually, preserving their source and age. An omitted condition
is unchanged. A never-reported condition is unreported. Silence does not mean
healthy, and an old report does not become fresh when Core forwards it again.
The interface does not invent an overall health verdict.

Requests, Core acceptance, and observed Asset outcomes are different evidence.
The interface follows Asset reports for effects rather than assuming success
from an accepted request.

## Submit supported work

The interface uses shared SDK checks when constructing requests. Core owns
[request admission](../../core/docs/requests.md) before forwarding over the field
link. The interface does not duplicate Core's admission logic or the Asset's
execution checks.

A turret's geographic pointing request includes the complete target position,
with altitude and its reference. Bearing and elevation use
[the agreed geographic conventions](../../asset/docs/assets.md#fixed-camera-turret).
Exact pointing messages and the tools for constructing those requests remain
open.

Task ordering, immediate commands, cancel, and settings follow Protocol's
[queue rules](../../protocol/docs/communication.md#delivering-a-task-queue),
[immediate-command rules](../../protocol/docs/communication.md#immediate-commands-and-cancel),
and [settings rules](../../protocol/docs/communication.md#settings).
Layout and other interface behavior remain open.
