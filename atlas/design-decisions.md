# Design decisions

Project-wide choices that every Atlas part follows.

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

## No generated code

Atlas code is written by hand and read by people. Do not generate code from
definitions or docs. Programs load the definitions as data instead.

## Spec, SDK and transports

Atlas is split into three layers, so each can change without breaking the others.

- **Protocol is the spec only.** Definitions, laws, examples and docs, with no
  implementation code. It is what carries the version number.
- **The SDK is the one implementation** and the stable front door every program
  uses: Core, bridges and operator apps. It builds, validates and parses
  messages, and handles keys, queueing and retry, and duplicates. Programs never
  touch bytes, compression or framing.
- **Transport adapters** are small plug-in packages under the SDK (WebSocket,
  Meshtastic, FLRC, and others). They only move bytes, plus any compression or
  splitting a link needs. Swapping one never changes the SDK's front door or
  the spec.

How changes are made:

- Internal changes, such as compression or encoding, are agreed between the two
  ends when a link opens. Programs do not see them.
- Changes to meaning are additive: new fields and messages, not changed ones.
- Breaking changes are rare. They are the only time the version number matters.

How drift is prevented:

- The SDK pins a Protocol version and loads its JSON definitions when it runs.
- Protocol's examples run as SDK tests in CI.
- Every Protocol PR runs the SDK tests.

Plan: Core's message handling moves into the SDK later, so Core uses the same
front door as every other program.
