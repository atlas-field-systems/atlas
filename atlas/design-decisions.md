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

- **Protocol is the spec.** Definitions, laws, examples and docs. It carries the
  version number, written once in Protocol and copied everywhere by a script.
- **The SDK is the one implementation** and the stable front door every program
  uses: Core, bridges and operator apps. It builds, validates and parses
  messages, and handles keys, queueing and retry, and duplicates. Programs never
  touch bytes, compression or framing. It lives in the Protocol repository, in
  `sdk/`, so a change to the spec and its implementation land together.
- **Transport adapters** are small plug-in packages beside the SDK (WebSocket,
  Meshtastic, FLRC, and others). They only move bytes, plus any compression or
  splitting a link needs. Each is its own package, so a program installs only
  the links it uses. Swapping one never changes the SDK's front door or the spec.

How changes are made:

- Internal changes, such as compression or encoding, are agreed between the two
  ends when a link opens. Programs do not see them.
- Changes to meaning are additive: new fields and messages, not changed ones.
- Every change after a release is a new version, additive or not. A released
  version never changes, so two ends with the same version have exactly the
  same definitions
  ([Protocol law 10](https://github.com/atlas-field-systems/protocol/blob/main/docs/laws.md)).

How versions and releases work:

- Protocol's main carries the version being worked on. It can still change until
  it is released.
- A release is a `v<version>` git tag. Nothing is published as a package.
  Protocol's tags are `v<major.minor>.<patch>`: major.minor is the protocol
  version, and the patch counts releases that change no message, such as SDK fixes.
- Protocol and Core each release by pushing main to their `production` branch
  (`git push origin main:production`). That runs the checks and makes the tag
  and a GitHub release. Only commits on main are released.
- Core has its own repository and moves only to release tags, never to
  Protocol's main, so spec work in progress never breaks it.

How drift is prevented:

- Protocol's examples run as SDK tests, in the same repository.
- A program outside the Protocol repository, such as Core, pins one release and
  loads its JSON definitions from it.

**SDK how-it-works is locked** for protocol 0.8 (see
[protocol `sdk/how-it-works.md`](https://github.com/atlas-field-systems/protocol/blob/main/sdk/how-it-works.md)
once 0.8 is on main; until then the PR that lands it). Highlights that bind Core
and Assets:

- **Core uses the SDK.** Shared `check()` validates schemas. Core keeps business
  rules only — it does **not** re-implement validation or keep a second dedupe set.
- **Assets use the SDK** too (IP Assets and Core-created messages with `from` =
  `CORE`).
- **Origin:** every message carries `from`; Core forwards other creators unchanged.
- **Hello vs describe:** keys stay on hello; description is a separate keyless
  `admin.describe` (no `admin.asset`).
- **Queue:** Core owns an ordered `task_id` list; no `task_seq` / gap-wait.
- **Caller surface:** `request` / `stream` / `subscribe`; outcomes
  `accepted` | `rejected` | `unknown`.
- **Transports:** bytes-only adapters (`open` / `send` / `onData` / `onClose` /
  `close`).
- **No generated code;** load JSON definitions at runtime. Strict version mismatch
  refuses the link (on purpose).

Runtime SDK code is not started; Core stays on its pinned Protocol release until
a protocol-bump adopt PR.
