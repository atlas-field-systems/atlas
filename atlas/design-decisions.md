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
  Core's Plugin interface, never its storage.
- **Outside the city.** Gateways, Assets, and operator applications reach Core
  only through the public Core API.

The parts:

- **Protocol is the spec.** It owns the shared records, the data laws, the one
  validator, and the examples that test record shapes. Its published package
  version is its only version; no version is embedded in definitions or records.
- **Core owns the Core API.** It uses HTTP for requests and Server-Sent Events
  for live changes. Request and event bodies are Protocol records.
- **The SDK is the client** for the Core API, used by operator applications,
  Assets on IP, and gateways.
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
  accounts, Assets, and gateways. Sessions use HttpOnly cookies, so every browser
  tab shares one session.
- An admin adds each gateway and each Asset on IP in Core and receives its ID
  and key for its configuration. Keys are bearer tokens over TLS. There is no
  enrollment key.
- Core authenticates a gateway. An Asset behind a gateway authenticates to the
  gateway, not to Core, in whatever way its Fieldlink uses. That is not designed
  yet.
- TLS secures IP links. Each Fieldlink uses its radio's own encryption and
  authentication. Records never carry credentials.

## Work is always a Task

Every command is a Task with a Core-assigned `task_id`, so every command reports
an outcome. Core numbers each Asset's Tasks in order and sends every Task as
soon as it accepts it, so an Asset that loses contact already holds its work. The
Asset runs its Tasks in number order. A Task can run now, cancelling the Tasks
before it. Cancel names its Task. Pause is a setting. Retries are safe by design:
creates carry an idempotency key, settings are end states, and each `task_id`
runs once.

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
