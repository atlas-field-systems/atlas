# Ideas from past Atlas command interfaces

Historical research and recommendations. The owner's subsequent choices live in
[selected behavior](README.md), including RidgeLine, separate detail pages,
external basemap services, and removal of natural-language interaction from scope.
This note preserves the original recommendations; it does not select behavior.
**Keep** means retain the idea for consideration,
**change** means retain its purpose with the changes described, and **trash** means
do not carry that historical approach forward. These are recommendations, not approvals.

## Basis and limits

Current baseline: `f814e406bc0be0bc02eb050eb1722afbeed838f9`. Read against the
[Charter](../../atlas/CHARTER.md), [design decisions](../../atlas/design-decisions.md),
[operating environment](../../atlas/environment.md), and
[interface ownership rules](../AGENTS.md). Existing selected rules already require
supported controls, separate conditions with source and age, shared SDK checks,
and separation of request, acceptance, and outcome. The proposals below concern
how to present those facts; they do not reopen the shared contracts.

Research inspected default-branch source snapshots on 2026-11-08. Connected GitHub
file fetch worked. Code search returned empty results and one rate-limit error,
so read-only `gh api` repository metadata and commit-pinned source archives supplied
the substantive investigation. All nine named repositories were accessible,
including private repositories. Private source links require repository access.

"Implemented" below means the behavior exists in inspected source, not that it was
run, deployed, or validated in field use. No historical application was executed.
This is a snapshot review, not an exhaustive review of deleted code, other branches,
or every commit. The current checkout's retained prototype is outside this note's
historical investigation.

## Sources across generations

| Repository | Revision inspected | What it contributes |
| --- | --- | --- |
| [atlas-c3-retired](https://github.com/the-Drunken-coder/atlas-c3-retired/tree/aa426c34789866370c180f19b18d9c08b5486f56) | `main` at `aa426c34789866370c180f19b18d9c08b5486f56` | Interface planning, explicitly deferred screens. Core and its administration CLI also exist; that CLI is not an operator interface. |
| [Atlas-Modernization](https://github.com/the-Drunken-coder/Atlas-Modernization/tree/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d) | `main` at `0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d` | Substantial implemented map console, command forms, Tasks, geometry tools, and movement history. |
| [ATLAS2-retired](https://github.com/the-Drunken-coder/ATLAS2-retired/tree/e3b08b81320098c8478af0d39a398f6adf3839bd) | `main` at `e3b08b81320098c8478af0d39a398f6adf3839bd` | Core, Protocol, and deferred SDK planning. No dedicated command-interface application found in the inspected tree; do not present its plans as a UI. |
| [ATLAS-retired](https://github.com/the-Drunken-coder/ATLAS-retired/tree/3b948e85fb5ee199937f8f45c4652d0186c4ad1b) | `main` at `3b948e85fb5ee199937f8f45c4652d0186c4ad1b` | Implemented React map interface, sidebars, command dispatch integration, diagnostics, and demo handling. |
| [ATLAS-Testing-WebUI-retired](https://github.com/the-Drunken-coder/ATLAS-Testing-WebUI-retired/tree/fbd1c50471099ebc592be8e2fca41dcdffcdc1f9) | `master` at `fbd1c50471099ebc592be8e2fca41dcdffcdc1f9` | Implemented Asset simulator, track generator, and object-upload test screens. |
| [ATLAS-natural-language-interface-demo-retired](https://github.com/the-Drunken-coder/ATLAS-natural-language-interface-demo-retired/tree/30590a88bac953081feca1cd9e8fda80c481aad3) | `master` at `30590a88bac953081feca1cd9e8fda80c481aad3` | Implemented chat frontend and tool-calling worker, including a geofeature deletion tool. |
| [atlas-docs-retired](https://github.com/the-Drunken-coder/atlas-docs-retired/tree/f38d185c729aee4d85b80e82eff64d7bb0c94474) | `main` at `f38d185c729aee4d85b80e82eff64d7bb0c94474` | Interface and SDK proposals, not proof of implementation. |
| [ATLAS-dev-retired](https://github.com/the-Drunken-coder/ATLAS-dev-retired/tree/145f4a13b05547c789bc583fcf5e1d2505b3c906) | `main` at `145f4a13b05547c789bc583fcf5e1d2505b3c906` | Inspected tree contains only ATLAS CORE/LICENSE. No UI evidence at this revision. |
| [ATLAS-OS-retired](https://github.com/the-Drunken-coder/ATLAS-OS-retired/tree/ad16f81fe3310f33696309ae639aff2a117e9258) | `main` at `ad16f81fe3310f33696309ae639aff2a117e9258` | Asset and gateway software. No operator UI found in the inspected tree. |

C3's [interface module][C3 planning] explicitly defers layout and authoring flows.
ATLAS2's [ownership index][ATLAS2 scope] and [SDK status][SDK planning] identify
planning boundaries. The [OS overview][OS scope] confirms its different focus.
These gaps limit historical UI evidence; they are not repository access failures.

## Choices to consider

### 1. Keep a linked map, searchable list, and detail panel

History: Modernization wires selected entities into the [map shell] and supplies a
filterable [entity browser] with selected rows and focus recovery. The [older map]
also connects Assets, Tracks, geofeatures, and command overlays.

Recommendation: **Keep** the interaction. An operator can find an Asset by ID,
select it, and inspect the same Asset on the map without losing context. Preserve
a usable list and detail view when map data is unavailable. A reporting-only Asset
must remain useful without flight controls. Exact layout and visual styling remain open.

### 2. Keep explanations beside supported commands

History: Modernization's [command details] show Protocol and Asset descriptions,
queued versus immediate scheduling, and cancel and progress support.

Recommendation: **Keep** concise explanations of what the selected Asset explicitly
supports. This gives the selected supported-controls rule a readable presentation.
Use current Protocol and SDK information, not the historical manifest shape or a
UI-maintained command catalog. Explain unavailable information without treating an
unknown current setting as unsupported.

### 3. Change map commands into explicit, reviewable requests

History: [Flight forms][flight forms] show destination coordinates, altitude units,
and the source of prefills. The [command flow] checks selection and capability
state before submission, but directly submits commands without a registered form.

Recommendation: **Change** the interaction so a field action exposes the target
Asset, parameters, units, and queue effect before the operator sends it. A map
click fills a draft. It must not hide an immediate dispatch. Keep simple actions
short; do not copy historical flight semantics or thresholds. Use SDK checks for
request construction and leave current equipment checks to the Asset.

### 4. Change Task rows into a visible evidence trail

History: The [task inspector] separates active, queued, and historical Tasks.
[Task feedback] shows pending cancellation, errors, status, and inspectable payloads.

Recommendation: **Change** the rows to distinguish the operator's request, Core's
acceptance, and the Asset's reported outcome, including source and age. Acceptance
must never paint a Task as completed. A cancel request remains pending evidence
until its outcome is known. Display queue order and immediate-command effects from
current Protocol rules, not the old status vocabulary.

### 5. Change connection and status presentation to preserve uncertainty

History: The [status inspector] shows link, heartbeat, battery, and telemetry age,
but includes a flight section in the Asset inspector. The separate [connection badge]
provides error details and retry interaction.

Recommendation: **Change** this into distinct Core connection, reported Asset
contact, and individual subsystem-condition displays. Keep timestamps and explicit
unknown values. Receipt time does not prove measurement freshness or two-way
contact. Show flight fields only where relevant. Do not derive an overall ready
verdict from a green connection indicator.

### 6. Change history browsing to fit a run and reveal gaps

History: [History controls] offer time windows and expose retention limits, empty
intervals, loading, and errors while retaining previous history.

Recommendation: **Change** the defaults to the current run rather than adopting the
historical 30-day option or its limits. Mark historical inspection clearly beside
live state. Reveal missing or unavailable intervals and preserve sample times;
do not imply uninterrupted observation between reports. Fetch history on demand
through the SDK, with live field traffic taking priority. No new retention promise
or historical message shape is selected here.

### 7. Change geometry drawing into an unmistakable draft

History: The older [geometry authoring] form supports map-picked coordinates,
radius entry, and polygon or line points before calling its submit handler.

Recommendation: **Change** the workflow to keep a draft visibly separate from
shared geometry, with clear finish and discard actions. Review the shape and units
before sending it through SDK checks. Drawing an area does not automatically task
an Asset or create an enforced geofence. Geometry formats and IDs must come from
current shared contracts; the older coordinate arrays are not a migration target.

### 8. Change object upload into evidence inspection first

History: The test UI's [object upload] links files to entity or Task references and
records filename, size, and content type after the client call succeeds.

Recommendation: **Change** the priority to inspecting an Object's metadata,
provenance, relationship to a Task, and availability of its bytes. Metadata presence
must not imply a file was received or viewed. Add manual upload only for a concrete
operator story. Keep transfers explicit and SDK-owned so evidence browsing does
not silently consume constrained field capacity.

### 9. Keep the SDK boundary; discard old sync recipes

History: Modernization's [SDK data source] reads SDK snapshots and commands.
C3's [interface plan][C3 planning] assigns bootstrap and recovery to the SDK.
An [earlier refresh proposal] favors periodic full queries, while the older
[UI sync hook][older sync hook] exposes polling and cache retry configuration.
These are different historical approaches, not one settled design.

Recommendation: **Keep** the SDK as the front door. **Trash** copying polling,
reconciliation, retry, validation, or deduplication into interface components.
The interface presents SDK contact and outcome information and owns local view
state. Historical SDK modes, method names, and ATLAS2's Core-owned validation
proposal do not override today's shared SDK ownership.

### 10. Keep an optional diagnostic view

History: The [raw inspector] exposes entity JSON, and [Task feedback] includes a
collapsed Task payload drawer.

Recommendation: **Keep** optional inspection of source records and request errors
for trusted testing. The normal flow still explains the outcome in plain language.
Label record time and source rather than requiring the operator to infer them
from raw JSON. Do not turn this into a second logging service or domain model.

### 11. Change simulation into a separate, persistently labeled context

History: The [simulator] offers editable telemetry and a local activity log.
The [track generator] creates randomized tracks through a client. The older
[fading demo banner] removes its warning after a short display interval.

Recommendation: **Change** simulation into an explicit test context with a persistent
label and clear destination. **Trash** fading away the warning that data is
simulated. Never replace an outage with plausible sample data. Retain the useful
ability to exercise stale reports, absent capabilities, rejected requests, and
unknown outcomes without confusing those scenarios with real field evidence.

### 12. Trash unrestricted natural-language writes; defer conversational help

History: The demo's [NL tools] and [NL execution loop] execute model-requested
calls directly. [NL deletion] checks that an entity is a geofeature, then deletes
it without a separate operator confirmation in that path. The [NL service] calls
an external model service. The type check is a guard, not proof of intended deletion.

Recommendation: **Trash** automatic model-authorized mutation as the operator flow.
Defer conversational assistance until ordinary inspection and request authoring
work well. If revisited, start with source-linked read-only answers or editable
request drafts. Resolve the exact target ID and use the same visible submission
flow and SDK checks. An external model must not become a prerequisite for local
field operation.

### 13. Trash mandatory remote map and runtime dependencies

History: The older [tile providers] build direct provider URLs, including a CARTO
CDN URL. [Modern map config][modern map config] likewise defines remote tile sources.
Their presence is implemented dependency configuration, not evidence of offline maps.

Recommendation: **Trash** those dependencies as a required runtime foundation.
Ship scripts, styles, fonts, symbols, and required map resources with the repository
or package to meet the no-CDN rule. Keep local list and detail inspection working
without internet. Any later external map-data option needs an explicit owner choice
consistent with that rule and field operation, not silent adoption of old URLs.

## Recommended owner review order

Start with linked selection, request review, evidence-aware Task feedback, and
separate connection and condition displays. Those choices exercise the immediate
operator story with the fewest new concepts. Review history, geometry authoring,
and Object workflows against concrete flight stories next. Defer conversational
control and broad simulation tooling until the ordinary workflow is understandable.

A useful review story is: select an Asset, inspect old telemetry, prepare a request,
lose the link after Core accepts it, and later receive the Asset's outcome. The
interface must make every known fact and remaining uncertainty readable throughout.
This is a proposed review exercise, not a claim that a historical interface passed it.

[map shell]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/MapConsole.tsx#L550-L655
[entity browser]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/EntityList.tsx#L32-L107
[older map]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Command_Interface/src/pages/map/MapPage.tsx#L101-L159
[command details]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/commands/CommandDetails.tsx#L9-L23
[command flow]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/commands/use-command-flow.ts#L153-L224
[flight forms]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/commands/flight-inputs.tsx#L67-L147
[task inspector]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/assets/AssetInspector.tsx#L142-L194
[task feedback]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/shared/TaskRow.tsx#L16-L90
[status inspector]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/assets/AssetInspector.tsx#L83-L138
[connection badge]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/ui/ConnectionBadge.tsx#L89-L140
[history controls]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/history/MovementHistorySection.tsx#L59-L132
[geometry authoring]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Command_Interface/src/widgets/sidebars/geofeatures/GeoFeatureCreateSidebar.tsx#L90-L165
[object upload]: https://github.com/the-Drunken-coder/ATLAS-Testing-WebUI-retired/blob/fbd1c50471099ebc592be8e2fca41dcdffcdc1f9/src/pages/ObjectUpload.tsx#L52-L102
[SDK data source]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/atlas/data-source.ts#L53-L172
[older sync hook]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Command_Interface/src/entities/api/query/useAtlasDataSync.ts#L69-L108
[C3 planning]: https://github.com/the-Drunken-coder/atlas-c3-retired/blob/aa426c34789866370c180f19b18d9c08b5486f56/atlas-docs-next/module-docs/atlas-command-interface/README.md#L7-L47
[earlier refresh proposal]: https://github.com/the-Drunken-coder/atlas-docs-retired/blob/f38d185c729aee4d85b80e82eff64d7bb0c94474/subsystems/atlas-command-interface.md#L46-L64
[SDK planning]: https://github.com/the-Drunken-coder/ATLAS2-retired/blob/e3b08b81320098c8478af0d39a398f6adf3839bd/docs/atlas-sdk/design-principles.md#L3-L44
[raw inspector]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/features/assets/AssetInspector.tsx#L186-L194
[simulator]: https://github.com/the-Drunken-coder/ATLAS-Testing-WebUI-retired/blob/fbd1c50471099ebc592be8e2fca41dcdffcdc1f9/src/App.tsx#L111-L169
[track generator]: https://github.com/the-Drunken-coder/ATLAS-Testing-WebUI-retired/blob/fbd1c50471099ebc592be8e2fca41dcdffcdc1f9/src/pages/TrackGenerator.tsx#L77-L124
[fading demo banner]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Command_Interface/src/widgets/status/DemoModeIndicator.tsx#L15-L49
[NL tools]: https://github.com/the-Drunken-coder/ATLAS-natural-language-interface-demo-retired/blob/30590a88bac953081feca1cd9e8fda80c481aad3/src/index.js#L230-L256
[NL execution loop]: https://github.com/the-Drunken-coder/ATLAS-natural-language-interface-demo-retired/blob/30590a88bac953081feca1cd9e8fda80c481aad3/src/index.js#L343-L405
[NL deletion]: https://github.com/the-Drunken-coder/ATLAS-natural-language-interface-demo-retired/blob/30590a88bac953081feca1cd9e8fda80c481aad3/src/atlasBackend.js#L84-L105
[NL service]: https://github.com/the-Drunken-coder/ATLAS-natural-language-interface-demo-retired/blob/30590a88bac953081feca1cd9e8fda80c481aad3/src/index.js#L260-L278
[tile providers]: https://github.com/the-Drunken-coder/ATLAS-retired/blob/3b948e85fb5ee199937f8f45c4652d0186c4ad1b/Atlas_Command_Interface/src/shared/ui/prefabs/MissionMap/tileManagement.ts#L65-L143
[modern map config]: https://github.com/the-Drunken-coder/Atlas-Modernization/blob/0dcad33c9d276e3695eaf08f6c491cdf5eb1d23d/surfaces/command-interface/src/app/config.ts#L59-L143
[ATLAS2 scope]: https://github.com/the-Drunken-coder/ATLAS2-retired/blob/e3b08b81320098c8478af0d39a398f6adf3839bd/docs/README.md#L3-L17
[OS scope]: https://github.com/the-Drunken-coder/ATLAS-OS-retired/blob/ad16f81fe3310f33696309ae639aff2a117e9258/README.md#L1-L17
