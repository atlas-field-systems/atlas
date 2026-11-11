# Design decisions

Project-wide choices that every Atlas part follows.

Coding judgment (root cause vs patch-as-feature, docs vs plans, accepted vs done, and related rules) lives in [Keep judgment sharp](CHARTER.md#keep-judgment-sharp).

The [API proposal](api-proposal.md) records the move from one shared message model
to a Core API with gateways. The decisions below follow it.

## Two layers of documentation

Each part has short pages a person can read, backed by exact definitions,
examples, and tests. The pages explain. The definitions, examples, and tests
are precise, and they keep AI agents from drifting.

## Proven and lean

Prefer proven existing systems over building our own. Keep each design lean and
minimal: give a part only what the product needs.

## Decisions stay near their source

Keep decisions with the part that has the authoritative information. Core checks
requests before they cross a field link, using Protocol's validator.
Assets own current equipment checks, execution, and local failsafes. Gateways and
their Fieldlinks supply field-link mechanics. This keeps decisions local and
avoids unnecessary exchanges over constrained links.

[Core request admission](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/requests.md)
and [Asset behavior](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md)
own the detailed responsibilities.

## Data formats belong to the owner

The project owner decides Atlas's data formats and data structures. Protocol
writes them down exactly. See [Keep shared data simple](CHARTER.md#keep-shared-data-simple).

## Avoid lock-in

Do not tie Atlas to one vendor, link, library or communication pattern. Keep
patterns flexible (push, ask, repeat, one link or many) so a part can change
without reworking the rest.

## Rapid prototyping

Prototypes sanity-test the docs. Build a small working version early, see where
the docs are wrong or missing, and write the findings back into the spec and the
owning docs. A prototype proves nothing on its own; the docs stay the source.

## No generated code

Atlas code is written by hand and read by people. Do not generate code from
definitions or docs. Programs load the definitions as data instead.

## Tests come from behavior

Write tests from what a part must do. Never generate them from Protocol's
definitions. A system and its tests built from the same definitions agree with
each other even when both are wrong. Protocol's examples test only record shapes
and the validator. Behavior tests come from the scenarios the owner states in
each part's docs, from ArduPilot SITL, and from hardware.

## A walled city

Atlas is laid out in rings, so each can change without breaking the others.

- **Inside the inner wall.** Core and Fusion run in one process. Core is built
  from [pillars](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/pillars.md),
  among them Entities, Tasks, and Objects, over shared storage and the event
  log. Fusion works on Core's state directly, never through the public API.
- **The second ring.** Plugins run beside Core and reach it only through
  Core's Plugin interface, never its storage. A Plugin is its own program that
  connects out to Core with its own key, like a gateway. Core never calls a
  Plugin and never runs one in its own process. The Plugin interface is the
  Core API calls a Plugin's key may use, not a second protocol.
- **Outside the city.** Gateways, Assets, and operator applications reach Core
  only through the public Core API.

The parts:

- **Protocol is the spec.** It owns the shared records, the data laws, the one
  validator, and the examples that test record shapes. Its published package
  version is its only version; no version is embedded in definitions or records.
- **Core owns the Core API.** It uses HTTP for requests and Server-Sent Events
  for live changes. Event bodies are Protocol records. Request bodies are
  Protocol request definitions, not records: Core stamps the record fields,
  such as time, Task ID, and who asked.
- **The SDK is the client** for the Core API, used by operator applications,
  Assets on IP, gateways, and Plugins.
- **Gateways** run on their own computers, uplink to the Core API over
  broadband IP, and run the Fieldlinks their hardware supports. A gateway is not
  an Asset.
- **Fieldlinks** carry Atlas across one kind of field link, such as Meshtastic
  LoRa. The same Fieldlink package runs on the gateway and on the radio Asset. It
  owns compact encoding, retries, duplicate handling, contact timing, and link
  security for its medium.

## Core keeps one event log

Core keeps current state in ordinary SQLite tables. Every accepted request and
every Asset report also adds a row to an append-only `events` table, with a
rising integer `event_id`, in the same transaction. Live updates, history and
recovery after a refresh read `events`; current state is read from the tables,
never rebuilt from events. A slow or disconnected reader resumes from its last
`event_id`; Core never buffers its backlog. See
[Core storage](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/storage.md).

## Identity and security

- Operators log in to accounts, with admin and operator types. Admins provision
  accounts, Assets, gateways, and Plugins. Sessions use HttpOnly cookies, so every browser
  tab shares one session.
- An admin adds each gateway, each Asset on IP, and each Plugin in Core and
  receives its ID and key for its configuration. Keys are bearer tokens over TLS.
  There is no enrollment key. Only gateways, Assets on IP, and Plugins hold Core
  keys.
- Core authenticates a gateway and trusts it for which radio Asset sent what. A
  radio Asset authenticates to the gateway with its own radio identity, not to
  Core, and appears as an Asset when the gateway first hears it.
  [Gateway](https://github.com/atlas-field-systems/atlas/blob/main/gateway/README.md)
  owns these rules.
- TLS secures IP links. Each Fieldlink uses its radio's own encryption and
  authentication. Records never carry credentials.

## Work is always a Task

Every command is a Task with a Core-assigned `task_id`, so every command reports
an outcome. Core numbers each Asset's Tasks in order and sends every Task as
soon as it accepts it, so an Asset that loses contact already holds its work. The
Asset runs its Tasks in number order. A Task can run now, cancelling the Tasks
before it. Cancel names its Task. Pause is a setting that holds the active Task
without ending it; the Task continues on resume. A command that uses a place names it and carries no copy of its shape. The
Asset gets the place's current shape through Core and follows later edits. Retries are safe by design:
creates carry an idempotency key, settings are end states, and each `task_id`
runs once.

## Evidence and conclusions stay apart

The shared picture holds Assets, Observations, Tracks, and geo features.
Observations are evidence: what an Asset reports seeing, and they change only
when it reports. Tracks are conclusions, and only Fusion makes, changes, or
removes them; an operator who disagrees with a Track hides it in their own view.
Geo features are places any operator or admin may create, replace whole, or
delete, and Plugins may create. Nothing in the picture expires during a run, and Core adds no stale
status: every record keeps its time, and the Command Interface shows its age.
[Core API, Entities](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#entities)
owns the exact rules.

## Failsafes are configured rules, reported apart from Tasks

The Asset runs failsafes locally, and the records follow that
[behavior](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/failsafes.md).

- An Asset's failsafe rules are one setting, its failsafe policy, always
  replaced whole. Any operator may replace it outside failsafe state, as with
  other settings.
- A rule's response is always a command the Asset supports. There is no
  "continue": activation always stops ordinary work, so an Asset that should
  keep working has no rule for that situation. A battery rule uses a set
  percentage, not an estimate of the charge needed to get home.
- A failsafe Task gets no Core `task_id`. Its rule and attempt name it, and its
  state travels in the failsafe report, apart from Core's numbered Tasks.
- Once a failsafe latches, it stays latched: ordinary work stays locked for the
  rest of the operation, and an equal- or lower-priority rule never runs again.
- Subsystems are declared in the description and reported one at a time. There
  is no overall Asset condition, and a condition never gates work by itself.

## Plugin actions and Objects

- Protocol defines every Plugin action's inputs and list output, as it defines
  command kinds. A Plugin only lists the actions it offers, and Core checks
  calls and answers with Protocol's one validator. A new action is a Protocol
  change.
- A Plugin call is accepted, not done, like a Task. It ends with the Plugin's
  result or failure, or is dropped when the Plugin goes offline or is removed. Plugins create
  only geo features and Objects, and never direct Assets.
- The Command Interface builds each Plugin action's form, menus, and result
  view from its description, with display choices that ship with the Plugin.
  A new Plugin needs no interface change. Plugins bring no screens or code into
  the interface; custom Plugin screens are a possible later step.
- An Object is a file Core holds. Plugins and operators add Objects; files from
  Assets are not designed yet. A file never changes, and Core records who
  stored it.

The [Core API](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#objects)
owns the calls and [Plugins](plugins.md) the intended use.

## Stack

- Core, the SDK, gateways, Fieldlinks, the Asset app, and the Command Interface
  use TypeScript. Node 24 runs `.ts` directly, so Node programs have
  no build step.
- Core and Fusion ship as one Docker container running one process. Each Plugin
  may run in its own container. Gateways run on their own computers.
- Storage uses SQLite.

## Design the whole product, then build it

Atlas is designed as the complete product before the real build. That covers
Assets, Tasks, settings, reports, history, accounts, geo features, Objects,
Observations, Tracks, Fusion, and Plugins. Throwaway prototypes test the design first. The
build then implements everything together from the finished design, not one
slice at a time. First flight is the first field test of that build.

## Changes and releases

- Every program in a deployment uses the same Protocol definitions. A change to
  them reaches Core, gateways, Assets, and the Command Interface together.
- Published packages are immutable. Changes are released through the package
  version, with no separate version counter.
- The Core API and each Fieldlink report the hash of the Protocol definitions they
  use. A mismatch is refused with an explanation.
- Protocol is an unpublished draft. Package publishing is not configured yet.
- Programs select Protocol through their package dependency.
- All Atlas work lands in this repository through `main`. Only approved commits
  on `main` are released through `prod`.
