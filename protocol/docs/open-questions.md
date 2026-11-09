# Open questions

Unresolved questions and work deliberately deferred. Selected answers live in
[decisions](decisions.md), [communication](communication.md), and
[storage](storage.md). Git history records earlier drafts.

## Unresolved

- **Core-assigned IDs (proposal).** The owner is considering Core assigning and
  retaining all IDs, including Asset IDs. Decide which IDs this covers, how a
  participant first enrolls without an ID, and what survives a manual Asset
  restart. Current IDs follow [law 22](laws.md).
- **Task retrieval after interface refresh.** The interface uses the SDK to
  retrieve requested Task bodies, latest outcomes, and queue order from Core.
  Define how to retrieve this information and know when it is complete. The
  connect push and `query.core kind assets` do not supply all of it.
- **Pause and interrupted work.** [Pause](../../asset/docs/README.md#pause) stops
  current movement with a platform-specific hold or loiter. Define Task reporting
  and continuation after Resume, and the interrupted Task's outcome when a new
  immediate motion command replaces it.
- **Track delivery and freshness.** Core decides
  [when information is stale](../../core/docs/fusion.md#track-freshness).
  Define delivery and replay, last-sighting and stale-status fields, freshness
  thresholds, and whether a returning target keeps its Track ID.
- **Stored record formats.** [Storage](storage.md) describes the tables, but exact
  record formats are not defined yet. Protocol owns those formats, including
  storage on Assets and in the SDK cache ([law 1](laws.md)).
- **Report catch-up.** The [selected path](communication.md#report-catch-up) sends
  retained reports with original timestamps through ordinary report messages.
  Define bounded transfer that respects live traffic, how the Asset knows which
  samples Core retained, and how a reader knows whether the requested interval
  is complete. Account for duplicate retention across large backlogs. Asset
  recording limits and overflow behavior belong with the Asset.
- **Fetching an Object's file.** An operator interface fetches it from Core over
  HTTP by `object_id`. The exact request, and how it is authorized when keys travel
  only in the hello (law 17), are open.
- **Early and minimal startup.** Define the independent settings-support
  declaration and applicable acknowledgements for [selected Asset startup](../../asset/docs/README.md#start-and-connect),
  then align SDK interfaces and generated scenarios. Current settings definitions
  assume known startup home and nonempty connect values.
- **Subsystem-condition contracts.** Replace the overall condition with reports
  and records for [the selected subsystem model](../../asset/docs/status.md).
  Define declarations, bounds, query behavior, and replay for Core and the SDK
  picture.
- **Commands for other equipment.** Define exact turret-pointing and future
  fixed-wing commands following [the Asset model](../../asset/docs/assets.md).
  Multiple modules' concurrent work needs a concrete story before changing
  queue semantics.
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
