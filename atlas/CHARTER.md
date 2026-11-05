# The Atlas charter

Atlas helps operators understand field systems, request work, and retain evidence.
Read the [operating environment](environment.md) before designing a subsystem.

## Keep Atlas understandable

The owner must be able to read the docs whenever they change.
Use short user stories and visible data flows to expose mismatches with intended use.
Describe and review the intended user-visible flow before implementing it.
Keep unresolved product decisions visible in the owning subsystem's documentation.
Put a consequential restriction in its owning system's story before adopting it.

## Keep the systems replaceable

Entities, Tasks, Objects, and Plugins are four replaceable pillars.
Keep their interfaces small enough to rebuild one pillar without rebuilding Atlas.
Authentication and administration support the pillars.

Core retains the shared picture and requests for work. Separate projects provide
vehicle control, radio transport, map rendering, and operator applications.
The [system overview](using-atlas.md) shows how those parts fit together.

## Keep evidence honest

An accepted request and an observed result are different facts.
Receiving a report does not prove fresh measurements or two-way contact.
Each subsystem defines how it represents that evidence.

## Keep shared data simple

The owner decides Atlas's data formats and data structures. Protocol follows them and adds the exact fields.

- Each message has one time for the whole message. Mixed times are rare and need
  their own case. Every message carries `from` (the creator), `time`, and `seq`.
  Messages about one Asset also carry `asset_id`.
- Times are in milliseconds. Only specialized radio data uses nanosecond timing.
- Counters are ordinary numbers, not long numbers written as text.
- The whole data format lives in Protocol. Protocol defines both the messages and
  the storage layout. Core, the SDK cache, and Assets store data in those formats,
  built from the same variables, names, units, and shapes.
- Every ID is 1 to 4 letters or digits.

## Document ownership

- This charter owns Atlas's purpose, operating context, project-wide principles,
  and end-to-end usage examples.
- Subsystem documentation owns its behavior, failure cases, and planning decisions.
- Protocol owns exact shared contracts within the charter's
  [shared data rules](#keep-shared-data-simple). Core owns server mechanisms.
  SDK owns client behavior. Other components own their runtime details.

Keep each rule with its owner and link to it from other documents.
When a subsystem rule conflicts with the operating context, surface the mismatch
and resolve it explicitly. Neither document silently overrides the other.
Intended behavior is not proof of implementation.

## Keep judgment sharp

Coding agents uphold these fundamentals before changing Atlas. Subsystem AGENTS.md
files point here. Architecture detail lives in [design-decisions.md](design-decisions.md).

Fix the real hole. Adding a new concept, field, or mechanism to paper over a bug is
a design problem. Prefer deleting the wrong thing over layering a new one.

Plan first-class shapes early. Capabilities that will matter later — fusion, tracks,
geo features, and the like — belong in the protocol picture before first flight
forces a hack. Defer the implementation if needed; do not defer the shape.

Fail loud on purpose. Prefer strict version and contract breaks that surface
mismatch early over silent compatibility. Do not invent protocol fields to paper
over attribution or routing the link or Core already owns.

Protocol is the spec. The SDK is the one implementation and front door. Core uses
the SDK and keeps business rules only — no second validation or dedupe stack.
See [design-decisions.md](design-decisions.md).

Locked how-it-works, laws, and communication docs beat an implementation plan when
they conflict. Change a lock on purpose with the owner; do not quietly diverge in
code.

An `admin.reply` with accepted means Core passed something on or acknowledged a
report. Only Asset reports prove the effect. Do not treat acknowledgment as
completion.

Dedupe stops a message being acted on twice. Replays still reach readers —
streams, subscribers, and pictures. Forward other creators' messages unchanged.

SDK helpers report contact, queues, and outcomes. The Asset app owns motion and
failsafes. Helpers never fly.

Stress undecided ideas with small prototypes and write findings back into the docs.
The docs stay the source.

Every coding agent reads and upholds this charter and
[design-decisions.md](design-decisions.md). The Charter is the quality gate.

## Change Atlas deliberately

The owner approves behavior and scope. Engineers choose conforming details.
Keep selected decisions, proposals, and open questions distinct in subsystem docs.
Coding agents and their subagents follow this charter and
[design-decisions.md](design-decisions.md). Generated output, reviews, and
historical specifications do not approve changes and do not override this charter.
