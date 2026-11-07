# The Atlas charter

Atlas helps operators understand field systems, request work, and retain evidence.
Read the [operating environment](environment.md) before designing a subsystem.

## Everything is a draft

Atlas is greenfield. It is deployed nowhere and has no users to stay compatible with.
Every part of this repository, this Charter included, is a draft: any decision, law,
message, plan or piece of code may be reworked, rewritten or removed, and new ideas
are welcome. Nothing is locked. When something has a problem, consider reworking it
from the ground up before patching it.

Draft does not mean quiet change. Propose the change and its reason; the owner decides.

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
  Messages about one Asset also carry `asset_id`. The two often hold the same
  ID but are not a repeat: `from` is who made the message and `asset_id` is who it
  is about, as when Core asks a drone for its task list.
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
  SDK owns client behavior. [Asset](https://github.com/atlas-field-systems/atlas/tree/main/asset)
  owns how an Asset behaves, and
  [Command Interface](https://github.com/atlas-field-systems/atlas/tree/main/command-interface)
  owns how the operator application works. Other components own their runtime details.

Keep each rule with its owner and link to it from other documents.
When a subsystem rule conflicts with the operating context, surface the mismatch
and resolve it explicitly. Neither document silently overrides the other.
Intended behavior is not proof of implementation.

## Keep judgment sharp

Coding agents uphold these fundamentals before changing Atlas. Subsystem AGENTS.md
files point here. Architecture detail lives in [design-decisions.md](design-decisions.md).

Fix the real hole. Adding a new concept, field, or mechanism to paper over a bug is
a design problem. Prefer deleting the wrong thing over layering a new one.

Name important domain distinctions early so first flight does not conflate them
(for example Observation versus Track). Keep untested shapes provisional until a
concrete story, consumer, or prototype establishes what the contract needs. Commit
an exact contract early only when postponing creates a specific, explainable
obstacle. Do not let an imagined future architecture indefinitely delay first
flight; do not let first-flight shortcuts define the whole architecture either.

Matching protocol versions are required today; wire-contract changes follow the
selected versioning rules in [design-decisions.md](design-decisions.md) and
Protocol. Never silently reinterpret unsupported messages or conceal incompatible
behavior. Do not invent protocol fields to paper over attribution or routing the
link or Core already owns.

Protocol is the spec. The SDK is the one implementation and front door. Core uses
the SDK and keeps business rules only — no second validation or dedupe stack.
See [design-decisions.md](design-decisions.md).

How-it-works, laws, and communication docs beat an implementation plan when
they conflict. Change them on purpose with the owner; do not quietly diverge in
code.

Accepted acknowledgment and observed Asset outcomes are different facts. Asset
reports are the observed outcome under the contract, not the same fact as
acceptance. Preserve uncertainty when the outcome is not known — see
[Keep evidence honest](#keep-evidence-honest). State guarantees together with
their assumptions and recovery boundaries. Preserve message identity when
forwarding, and separate repeated effects from repeated delivery. Exact rules live
in Protocol (`communication.md` / SDK docs).

SDK helpers report contact, queues, and outcomes. The Asset app owns motion and
failsafes. Helpers never fly.

Stress undecided ideas with small prototypes and write findings back into the docs.
The docs stay the source.

Every coding agent reads and upholds this charter and
[design-decisions.md](design-decisions.md). The Charter is the **review standard**.
Reading or quoting it does not prove a change meets it. A change should make clear
what problem it solves, why this is the simplest credible fix, and what evidence
supports the claim.

## Change Atlas deliberately

The owner approves behavior and scope. Engineers choose conforming details.
Keep selected decisions, proposals, and open questions distinct in subsystem docs.
Coding agents and their subagents follow this charter and
[design-decisions.md](design-decisions.md). When evidence shows an approved
assumption is wrong, the agent explains the mismatch and proposes the smallest
correction; the owner still decides. Generated output, reviews, and
historical specifications do not approve changes and do not override this charter.
