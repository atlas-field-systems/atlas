# Command interface docs

Selected behavior, not implemented. Shared exchanges live in
[How Atlas parts communicate](../../protocol/docs/communication.md).
[Past interface ideas](past-interface-ideas.md) records the historical research;
the choices here supersede its recommendations.

## Operators and connectivity

This interface serves operators at a command station with internet access and a
connection to Core. An interface for teams at the edge is a separate future tool.
Offline basemap operation is not a requirement for this interface.
The interface uses the SDK's WebSocket transport adapter to read Core's
information and send requests over a local IP network or the internet.

External basemap tile services are allowed. Application code and assets ship with
the project under the repository's no-CDN rule. A basemap failure must remain
distinct from loss of Core contact; list and detail inspection remain usable.
The provider and its configuration are still open.

## Map and detail pages

The main page is `/map`, with the linked map, searchable list, and detail-panel
layout from the earlier interfaces. Selecting an item in the list or map shows
the same item in the panel and keeps its map context visible.

Assets, Tracks, and Observations also have their own addressable detail pages.
Their URLs can be shared, bookmarked, refreshed, and opened in another tab.
An operator can select an Asset on the map, inspect its summary, and open its
page for deeper inspection. Data and related records can link to their own pages;
inspection is not confined to one screen. Exact detail routes remain open.

Selecting a Track shows when it was last spotted. Core decides
[when information is stale](../../core/docs/fusion.md#track-freshness).
Track delivery contracts remain open.

Keep an unfinished request draft in memory while the operator visits other pages.
For example, opening a Geofeature's detail page to check its shape must not discard
the command inputs already entered. Persistence across reloads is not selected.

## RidgeLine and Atlas responsibilities

Use [RidgeLine](https://github.com/the-Drunken-coder/Ridgeline) for mapping and
reusable map tools. Atlas supplies its domain data, presentation, pages, command
forms, and operator workflows on top. RidgeLine remains a general-purpose package.

When RidgeLine needs a change, record a proposal in these docs. Also propose a
change when it would simplify Atlas, simplify the projects overall, or offer
another benefit. Describe the concrete need, the proposed package change, and
its benefit compared with handling it in Atlas. The owner decides; a proposal
does not authorize changes to the RidgeLine repository.

## Prepare requests with the map

Offer explicitly supported commands and settings, with explanations beside the
controls. Distinguish support from whether a current setting value is known.
A reporting-only tracker needs no movement controls, pause control, or artificial home.

Map interaction supplies inputs to a request draft. An operator can pick a point,
or two coordinates when the input requires them. For a polygon input, an operator
can select an existing Geofeature with suitable geometry. If a Task explicitly
requests a Geofeature, selection supplies that feature's identity. Geometry and
a reference to a Geofeature remain distinct inputs; exact shared contracts belong
to Protocol. A geometry input takes a snapshot of the selected shape. Later edits
to the Geofeature do not change that draft's geometry. At submission, retain the
chosen shape and Geofeature ID under [Protocol's snapshot rule](../../protocol/docs/storage.md#geo-features).
Later edits or deletion do not change the Task. A future Task needing a changing
reference requires an explicit contract.

Offer input-specific actions such as "Pick on map", "Choose Geofeature", and
"Draw". While picking, show which field is being filled. Escape cancels picking
without discarding the rest of the draft.

Before sending, show the target Asset, input values, units, and effect on the task
queue. Selecting a location or feature fills the draft. The operator submits it
explicitly. Keep simple actions short.

Use RidgeLine's drawing and editing tools for geometry authoring. Show drafts
separately from shared Geofeatures, with clear finish and discard actions. Review
the shape and units before sending. Drawing an area does not automatically task
an Asset or create an enforced geofence.

## Read Tasks, conditions, and history

After opening or refreshing, the interface retrieves Task instructions and
reported outcomes through the SDK. For example, an active Move To Task includes
its destination. The retrieval exchange remains
[open](../../protocol/docs/open-questions.md#unresolved).

Show active, queued, and historical Tasks. Distinguish the operator's request,
Core's acceptance, and the Asset's observed outcome, with source and age. A cancel
request stays pending until its outcome is known.

Show the Core connection, reported Asset contact, and
[subsystem conditions](../../asset/docs/status.md) separately. Preserve unknown
and unreported conditions. Receipt time does not prove measurement freshness or
two-way contact. Connection readiness does not establish equipment readiness;
do not invent an overall verdict. Show equipment-specific fields where relevant.

Movement history supports selectable time windows, playback, and scrubbing.
Start with one selected Asset's trail and a small set of controls. Keep its latest
reported position distinguishable from its historical position. Playback uses
recorded sample times and reveals gaps rather than inventing observations.
Clearly label historical inspection and provide a way to return to live state.
Playback and scrubbing never resend recorded commands.

Keep the implementation small; avoid a separate history framework. Fetch history
on demand through the SDK, respecting live field traffic. Full synchronized
reconstruction of every item on the map is not selected.

### Review a model-rocket flight

The operator requests launch through Atlas. The rocket is an Asset that initiates
ignition through a launch pad or its own equipment. The pad may be passive;
equipment layout and the exact launch command remain open.

The operator follows the flight until the rocket returns and lands, then opens
the recorded launch data. The operator scrubs back through the flight or plays
it, with the map and available flight measurements following the same playback
time. The goal is to inspect all recorded launch data,
including detail that was not available over the live link.

The rocket [records more data than it transmits live](../../asset/docs/README.md#record-and-send-report-history).
After landing, a restored or faster link carries the retained reports through the
ordinary [report catch-up path](../../protocol/docs/communication.md#report-catch-up).
Those reports keep their original times and fill in history for playback.
The interface distinguishes missing data from a recorded absence of
activity; receipt of live telemetry alone does not establish a complete flight
record. Recording limits and completion evidence remain open. Flight control,
landing, and ignition mechanisms belong to the Asset design.

### Diagnostics and simulation

Optional expandable views expose source records, Task payloads, and request errors
for testing and troubleshooting. Normal views explain the evidence without
requiring the operator to read JSON.

Simulation has a separate, persistently labeled test context and a clear
destination. Support useful test cases such as stale reports, missing
capabilities, rejected requests, and unknown outcomes. Do not substitute sample
data for an outage or let a simulation warning disappear.

## SDK use and development

Use the [current Atlas SDK design](../../sdk/README.md), including shared checks
to construct requests and the [live picture](../../sdk/docs/live-picture.md).
Communication, validation, retry, reconciliation, and duplicate handling belong
in the SDK. The interface owns local drafts and view state. Core owns
[request admission](../../core/docs/requests.md), and the Asset owns
[execution checks](../../asset/docs/README.md#carry-out-work-and-report-its-result).

Build and exercise the interface to discover what the SDK needs for operator and
administrative use. The SDK may change to meet those needs; record findings and
update the owning SDK docs instead of adding a second implementation in the UI.
SDK runtime code is not built yet. This direction does not start implementation.

Task ordering, immediate commands, cancel, and settings follow Protocol's
[queue rules](../../protocol/docs/communication.md#delivering-a-task-queue),
[immediate-command rules](../../protocol/docs/communication.md#immediate-commands-and-cancel),
and [settings rules](../../protocol/docs/communication.md#settings).

## Open choices and scope

The exact detail routes, history controls, package integration, and basemap provider
remain open. Report catch-up needs the [remaining shared contracts](../../protocol/docs/open-questions.md#unresolved).
Geometry-based and Geofeature-reference Task inputs need concrete stories and
shared input formats. Object inspection and manual
upload from the historical review still need an owner decision.

Natural-language interaction is out of scope. If revisited, it belongs on a
separate page; no conversational feature is selected now.
