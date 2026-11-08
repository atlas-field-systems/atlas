# Open questions

Unresolved questions and work deliberately deferred. Selected answers live in
[decisions](decisions.md), [communication](communication.md), and
[storage](storage.md). Git history records earlier drafts.

## Unresolved

- **Stored record formats.** [Storage](storage.md) describes the tables, but exact
  record formats are not defined yet. Protocol owns those formats, including
  storage on Assets and in the SDK cache ([law 1](laws.md)).
- **Operator keys.** Where operator IDs and keys come from is not decided. Core's
  prototype reads them from configuration ([prototype findings](../../core/docs/findings.md#remaining-gaps)).
- **Fetching an Object's file.** An operator interface fetches it from Core over
  HTTP by `object_id`. The exact request, and how it is authorized when keys travel
  only in the hello (law 17), are open.
- **Early and minimal startup.** Selected [Asset startup](../../asset/docs/README.md#start-and-connect)
  permits connection before equipment and position are ready. Settings support
  must be independent of known values, and Assets supporting no settings or
  task queue need no placeholder reports. Agree the support declaration,
  applicable acknowledgements, and SDK interfaces. Current settings definitions
  assume known startup home and nonempty connect values. Telemetry requires
  position, so a tracker without a fix sends no new position update. Align the
  generated scenarios after the exact contracts are selected.
- **Subsystem-condition contracts.** Selected [reporting](../../asset/docs/status.md)
  uses Asset-defined stable subsystem IDs and labels, fixed condition meanings,
  selective updates, recovery reports, and no mandatory periodic snapshots or
  overall verdict. Current `report.status` kind `asset` carries one overall
  condition. Agree the exact declarations, reports, bounds, query behavior,
  retained records, and replay needed by Core and the SDK picture. Omission
  keeps a condition unchanged. Silence does not imply healthy.
- **Commands for other equipment.** Agree exact turret-pointing commands for
  geographic targets and bearing with elevation, and future fixed-wing commands.
  [Selected behavior](../../asset/docs/assets.md) requires complete geographic
  targets and separates copter and fixed-wing command families. Existing command
  definitions do not yet express them. Multiple modules' concurrent work also
  needs a concrete story before changing queue semantics.
- **Quiet-Asset contact.** A check-in must not require periodic subsystem
  broadcasts or present an old position as a new fix. The current procedure
  assumes a useful listed report can be sent early. Select the exchange for an
  Asset with neither new measurements nor a relevant condition update, keeping
  [contact evidence](communication.md#when-core-counts-an-asset-offline) distinct
  from measurement freshness.
- **Failsafe contracts.** [Selected Asset behavior](../../asset/docs/failsafes.md)
  needs shared policy settings, locally created Task identities and outcomes,
  and command-refusal reports. Current definitions still encode unconditional
  link loss and a fixed response enum; they do not express combined conditions,
  parameterized response Tasks, or the operation-long work lock. Agree these
  formats before aligning the definitions and SDK interfaces.

Diagnostic logging and configuration choices are tracked with their owners in
[Core configuration](../../core/config.md), [Asset configuration](../../asset/config.md),
and [SDK configuration](../../sdk/config.md). They are not Protocol options.

## Deferred

- **Errors back to an Asset.** Core drops and logs an invalid report, and the Asset
  gets only acknowledgements. Revisit after first flight.
- **Uploads and other attachments.** Only Plugins make Objects. Uploads from
  operators or Assets, and Objects attached to an Asset, Task or Track, wait for a
  story.
- **Offline command holding.** The selected behavior is to refuse commands to
  offline Assets and hold nothing ([communication](communication.md#when-core-counts-an-asset-offline)).
  Revisit only if it becomes a real problem.

Building and stress-testing the SDK is implementation work, planned in
[the SDK docs](../../sdk/README.md), rather than an undecided protocol rule.
