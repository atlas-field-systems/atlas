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
- **Failure responses on Assets.** Every failure triggers a configured failsafe,
  but which failure triggers which failsafe is still open in the
  [Asset docs](../../asset/docs/README.md).

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
