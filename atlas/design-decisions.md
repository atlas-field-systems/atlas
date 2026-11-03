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
