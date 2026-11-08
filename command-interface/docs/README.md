# Command interface docs

Selected behavior, not implemented. Shared exchanges live in
[How Atlas parts communicate](../../protocol/docs/communication.md).

The interface uses the SDK's WebSocket transport adapter to read Core's
information and send requests over a local IP network or the internet.

After opening or refreshing, the interface retrieves Task instructions and
reported outcomes through the SDK. For example, an active Move To Task includes
its destination. The retrieval exchange remains
[open](../../protocol/docs/open-questions.md#unresolved).

Selecting a Track shows when it was last spotted. Core decides
[when information is stale](../../core/docs/fusion.md#track-freshness).
Track delivery contracts remain open.

The interface offers explicitly supported commands and settings, distinguishing
support from whether a current setting value is known. A reporting-only tracker
needs no movement controls, pause control, or artificial home.

Show [subsystem conditions](../../asset/docs/status.md) individually with source
and age. Preserve unreported conditions and do not invent an overall verdict.
Connection readiness does not establish equipment readiness. Show requests,
Core acceptance, and observed Asset outcomes as different evidence.

The interface uses shared SDK checks to construct requests. Core owns
[request admission](../../core/docs/requests.md), and the Asset owns
[execution checks](../../asset/docs/README.md#carry-out-work-and-report-its-result).

Task ordering, immediate commands, cancel, and settings follow Protocol's
[queue rules](../../protocol/docs/communication.md#delivering-a-task-queue),
[immediate-command rules](../../protocol/docs/communication.md#immediate-commands-and-cancel),
and [settings rules](../../protocol/docs/communication.md#settings).
Layout and other interface behavior remain open.
