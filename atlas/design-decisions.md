# Design decisions

Project-wide choices that every Atlas part follows.

Coding judgment (root cause vs patch-as-feature, docs vs plans, accepted vs done, and related rules) lives in [Keep judgment sharp](CHARTER.md#keep-judgment-sharp).

## Two layers of documentation

Each part has short pages a person can read, backed by exact definitions,
examples, and tests. The pages explain. The definitions, examples, and tests
are precise, and they keep AI agents from drifting.

## Proven and lean

Prefer proven existing systems over building our own. Keep designs lean and
minimal: build only what is needed now.

## Decisions stay near their source

Keep decisions with the part that has the authoritative information. Core checks
requests before they cross the field link, using the SDK's shared validation.
Assets own current equipment checks, execution, and local failsafes. The SDK and
transport adapters supply communication mechanics. This keeps decisions local
and avoids unnecessary exchanges over constrained links.

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

## Spec, SDK and transports

Atlas is split into three layers, so each can change without breaking the others.

- **Protocol is the spec.** Definitions, laws, examples and docs. Its published
  package version is its only version; no version is embedded in definitions or
  messages.
- **The SDK is the one implementation** and the stable front door every program
  uses: Core, bridges and operator apps. It builds, validates and parses
  messages, and handles keys, queueing and retry, and duplicates. Programs never
  touch bytes, compression or framing. It has its own folder, `sdk/`, beside
  Protocol, so each keeps its own history; a change to both can still land in one PR.
- **Transport adapters** are small plug-in packages beside the SDK (WebSocket,
  Meshtastic, FLRC, and others). They only move bytes, plus any compression or
  splitting a link needs. Each is its own package, so a program installs only
  the links it uses. Swapping one never changes the SDK's front door or the spec.

How changes are made:

- Internal changes, such as compression or encoding, are agreed between the two
  ends when a link opens. Programs do not see them.
- Changes to meaning are additive: new fields and messages, not changed ones.
- Published packages are immutable. Changes are released through the package
  version, with no separate wire-version counter or handshake negotiation.

How releases work:

- Protocol is an unpublished draft. Package publishing is not configured yet.
  When published, the package version is the protocol version. No draft protocol
  number or version-bump script is maintained in the spec.
- Programs select Protocol through their package dependency. Protocol's JSON
  definitions, examples, and messages contain no protocol-version metadata.
- All Atlas work lands in this repository through `main`. Only approved commits
  on `main` are released through `prod`.
- The retained Core prototype uses a historical Protocol snapshot. Its pin keeps
  that older runtime separate from current spec work until it is rebuilt or removed.

How drift is prevented:

- Protocol's examples run as SDK tests.
- Programs pin the Protocol package they use and load its JSON definitions.

How the SDK works is drafted in the
[SDK docs](https://github.com/atlas-field-systems/atlas/blob/main/sdk/README.md).
Runtime SDK code is not started. The retained Core prototype is not an
implementation of the current docs.
