# Design decisions

Project-wide choices that every Atlas part follows.

Coding judgment (root cause vs patch-as-feature, docs vs plans, accepted vs done, and related rules) lives in [Keep judgment sharp](CHARTER.md#keep-judgment-sharp).

The move from one shared message model to a Core API with gateways is recorded in
the [API proposal](api-proposal.md). The decisions below follow it.

## Two layers of documentation

Each part has short pages a person can read, backed by exact definitions,
examples, and tests. The pages explain. The definitions, examples, and tests
are precise, and they keep AI agents from drifting.

## Proven and lean

Prefer proven existing systems over building our own. Keep designs lean and
minimal: build only what is needed now.

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

## A walled city

Atlas is laid out in rings, so each can change without breaking the others.

- **Inside the inner wall:** Core and Fusion, in one process. Core keeps the
  shared picture, the event log, Tasks, and storage. Fusion works on Core's state
  directly, never through the public API.
- **The second ring:** Plugins. They run beside Core and reach it only through
  Core's Plugin interface, never its storage.
- **Outside the city:** gateways, Assets, and operator applications. They reach
  Core only through the public Core API.

The parts:

- **Protocol is the spec.** It owns the shared records, the data laws, the one
  validator, and the examples every program tests against. Its published package
  version is its only version; no version is embedded in definitions or records.
- **Core owns the Core API:** HTTP for requests and Server-Sent Events for live
  changes. Request and event bodies are Protocol records.
- **The SDK is the client** for the Core API, used by operator applications,
  Assets on IP, and gateways.
- **Gateways** uplink to the Core API and run the Fieldlinks their hardware
  supports. A gateway is not an Asset.
- **Fieldlinks** carry Atlas across one kind of field link, such as Meshtastic
  LoRa. The same Fieldlink package runs on the gateway and on the radio Asset. It
  owns compact encoding, retries, duplicate handling, contact timing, and link
  security for its medium.

## Core keeps one event log

Core appends every accepted request and every Asset report to an ordered log
with a rising integer `event_id`, stored on disk in SQLite. Current state is
derived from it. Live updates, history, recovery after a refresh, and the Reset
archive are all reads of the log. A slow or disconnected reader resumes from its
last `event_id`; Core never buffers its backlog.

## Identity and security

- Operators log in to accounts, with admin and operator types. Admins provision
  accounts, Assets, and gateways. Sessions use HttpOnly cookies, so every browser
  tab shares one session.
- An admin adds each Asset and gateway in Core and receives its ID and key for
  its configuration. Keys are bearer tokens over TLS. There is no enrollment key.
- TLS secures IP links. Each Fieldlink uses its radio's own encryption and
  authentication. Records never carry credentials.

## Work is always a Task

Every command is a Task with a Core-assigned `task_id`, so every command reports
an outcome. A Task can run now, clearing the queue. Cancel names its Task. Pause
is a setting. Retries are safe by design: creates carry an idempotency key,
settings are end states, and the queue carries its version.

## Stack

- **TypeScript everywhere:** Core, the SDK, gateways, Fieldlinks, the Asset app,
  and the Command Interface. Node 24 runs `.ts` directly, so Node programs have
  no build step.
- **Docker:** Core and Fusion ship as one container running one process. Plugins
  run in workers for now.
- **Storage:** SQLite.

## First flight comes first

Scope is frozen to first flight: Assets, Tasks, settings, telemetry, battery,
failsafe reports, history, and accounts. Geo feature, Object, Plugin, and
Observation contracts wait until after first flight. Asset tests run against
ArduPilot SITL.

## Changes and releases

- Changes to meaning are additive: new fields and records, not changed ones.
- Published packages are immutable. Changes are released through the package
  version, with no separate version counter.
- The Core API and each Fieldlink report the hash of the Protocol definitions they
  use. A mismatch is refused with an explanation.
- Protocol is an unpublished draft. Package publishing is not configured yet.
- Programs select Protocol through their package dependency and test against its
  examples.
- All Atlas work lands in this repository through `main`. Only approved commits
  on `main` are released through `prod`.
