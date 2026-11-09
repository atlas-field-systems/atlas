# Asset logging

The Asset records detailed evidence locally for the whole operation, including
while it has no contact with Core. It collects its own app and equipment events
and the diagnostics of its SDK client or Fieldlink. Logging is not implemented yet.

## Record decisions and observed equipment behavior

- Startup, configured modules and movement profiles, equipment-driver
  connections, the supported commands, configuration with secrets removed, and
  software and package versions, including the Protocol definitions hash.
- Each request received, and whether it was queued, run now, ignored as already
  handled, cancelled, or refused, with the reason.
- Each Task's start and final state, the equipment observations behind them, and
  command or equipment errors.
- Each applied settings change, whether requested, local, queued, or forced by a
  failsafe, with the resulting value and reason.
- Failsafe conditions, the selected rule and priority, interrupted Tasks, primary
  and fallback outcomes, and each operator override.
- Subsystem condition changes, and which ones the Asset chose to report.
- Contact changes, link loss and reconnects, report batches sent, and their
  acknowledgements.
- Gaps or failures in diagnostic output, even when flight continues.

Handing a command to the flight controller does not show that the drone
performed it; the log keeps the requested action and the observed result apart.
Records are correlated by `event_id`, `request_id`, `task_id`, and idempotency
key where present.

## Keep the record available without Core

The app owns its local diagnostic destination and merges its link's events with
its equipment events. Neither the SDK client nor a Fieldlink opens another file
or sends logs over the field link. [Asset configuration](../config.md) lists the
proposed destination, detail, content, and storage-limit options.

The proposal is structured local records with a readable rendering, and full
tracing for the prototype. Credentials are never recorded. Local event order is
kept; timestamps from another device do not set a global order. The log never
samples or drops records silently and then claims to be complete.

## Export the Asset's Reset ZIP

The Asset's archive holds its app, equipment, and link diagnostics, its
configuration with secrets removed, its settings and Task outcomes, its versions,
and a readable run summary. It complements Core's archive with what the Asset saw
while disconnected. The proposed procedure verifies the archive before
discarding its source evidence.

## Open

- Export trigger, retrieval, file layout, retention, and cleanup.
- What happens when storage fills or logging cannot keep up, without unbounded
  memory use or blocking equipment control.
