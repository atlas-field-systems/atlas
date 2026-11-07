# Asset logging

The Asset records detailed evidence locally throughout an operation, including
while its Core link is down. It collects both equipment and app events and the
[SDK's diagnostics](../../sdk/docs/logging.md). No Asset runtime implements this yet.

## Record decisions and observed equipment behavior

- Startup, equipment connection, capability discovery, resolved configuration
  with secrets removed, and the software and package versions in use.
- Each requested action and whether it was queued, applied immediately, ignored
  as a duplicate, cancelled, or rejected locally, with the reason.
- Task start and final outcome, the equipment observations used to decide them,
  and command or equipment errors.
- Each applied setting change, whether operator-requested, locally initiated,
  queued, or forced by a safe response. Record the resulting value and reason.
- Failure detection, its trigger and configured response, pause or hold changes,
  and what the equipment actually did.
- Local contact timing, link loss, continued local execution, reconnects,
  outgoing reports, and their acknowledgements through the SDK.
- Diagnostic output failures or gaps, even when the flight behavior continues.

A command being handed to the flight controller is not proof that the drone
performed it. Keep the requested action and observed result distinguishable in
the log. Correlate using the existing message identity and `task_id` where present.

## Keep the record available without Core

The app owns its local diagnostic destination and combines SDK events with its
equipment events. The SDK does not open another file or send logs over the radio.
[Asset configuration](../config.md) inventories the proposed destination, detail,
message-content, and storage-limit controls.

Proposed recording policy: structured local records, with a readable rendering
and full tracing for the prototype. Exclude credentials. Preserve local event
order; timestamps from another device do not establish a global event order.
Do not silently sample or drop records and then call the log complete.

## Export the Asset's Reset ZIP

The Asset's archive includes its local app, equipment, and SDK diagnostics;
configuration with secrets removed; local settings and task outcomes; versions;
and a readable run summary. It complements Core's archive with what the Asset
observed while disconnected.

The export trigger, retrieval mechanism, file layout, retention, and cleanup
procedure remain open. The proposed procedure verifies the archive before
discarding its source evidence. Recording limits and failures must not turn into
unbounded memory use or block the equipment-control loop indefinitely; the exact
overflow and full-storage response still needs a decision.
