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

The Asset writes its ZIP when the app shuts down, whether the operator stops it
or it [shuts itself down](README.md#shut-down-and-retain-evidence) after a
failsafe. An operation lasts from one start of the app to its shutdown, and
each ZIP covers one operation. There is no remote trigger, and nothing is sent
over the field link.

The ZIP goes into `archive_directory` ([configuration](../config.md)), named
`asset-<asset_id>-<start>.zip`, where `<start>` is the operation's start in UTC
as `YYYYMMDDTHHMMSSZ`. A person copies it off the Asset's computer by hand, for
first flight from the ground Raspberry Pi.

| File | Holds |
| --- | --- |
| `README.md` | What each file is |
| `summary.md` | Start and end, how the operation ended, each Task and its outcome, failsafes and overrides, contact losses, and every gap |
| `manifest.json` | Every file with its size and SHA-256, whether the operation ended normally, and every known gap |
| `diagnostics/` | The app, equipment, and link diagnostics, as written |
| `reports/` | Reports the Asset recorded, including those it never sent live |
| `config.json` | The configuration, with secrets removed |
| `versions.json` | App, SDK or Fieldlink, and Protocol package versions, and the definitions hash |

The Asset writes the ZIP under a temporary name, reads it back, and checks every
file against `manifest.json`. Only then does it give the ZIP its final name and
delete the operation's local records. If the ZIP fails, it deletes nothing and
removes the incomplete file. The app never deletes a ZIP; the owner deletes old
ones by hand.

If the app crashes or loses power, its next start writes the ZIP of the
interrupted operation, marked "the app stopped unexpectedly; this record may be
incomplete", and retries any earlier operation whose ZIP failed. Writing it
never delays rejoining Core. Then it starts
a new operation with nothing kept from the earlier one.

## When logging cannot keep up

Equipment control never waits for logging, and logging never grows memory
without limit. The app hands each diagnostic record to a writer through a
fixed-size queue and drops a record the queue cannot take. The queue holds
diagnostic records only. Reports the Asset keeps so it can send them later
never pass through it, and logging never drops or overwrites a report that is
still waiting to be sent. How the Asset catches up is
[not designed yet](README.md#open). Past `log_total_limit_bytes`,
or with the disk full, it stops writing. It counts everything it drops and
writes one gap record when writing works again and at shutdown: how many
records, between which times, and why. The ZIP lists every gap. Flight goes on
regardless.

## Open

- Default rotation and total limits.
