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
The owner's current decisions are the accepted [ADRs](../docs/adr/README.md). A
reversal updates every page that still teaches the old rule.

## Keep Atlas understandable

The owner must be able to read the docs whenever they change.
Use short user stories and visible data flows to expose mismatches with intended use.
Describe and review the intended user-visible flow before implementing it.
Keep unresolved product decisions visible in the owning subsystem's documentation.
Put a consequential restriction in its owning system's story before adopting it.

Each part has two layers of documentation. Short pages a person can read
explain it. Exact definitions, examples, and tests make it precise, and they
keep AI agents from drifting.

## Keep designs proven and lean

Prefer proven existing systems over building our own. Keep each design lean and
minimal: give a part only what the product needs.

Do not tie Atlas to one vendor, link, library or communication pattern. Keep
patterns flexible (push, ask, repeat, one link or many) so a part can change
without reworking the rest.

Generate code where it is a good idea, judged case by case.

## Keep the systems replaceable

Atlas is a [walled city](using-atlas.md#the-walled-city), laid out in rings so
each can change without breaking the others. Inside Core,
[pillars](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/pillars.md)
such as Entities, Tasks, and Objects keep interfaces small enough to rebuild one
without rebuilding Atlas. [Using Atlas](using-atlas.md) shows what each part does.

Keep each decision with the part that has the authoritative information. Core
checks requests before they cross a field link, using Protocol's validator.
Assets own current equipment checks, execution, and local failsafes. Gateways
and their Fieldlinks supply field-link mechanics. This keeps decisions local and
avoids unneeded exchanges over constrained links.
[Core request admission](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/requests.md)
and [Asset behavior](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/README.md)
own the details.

The SDK, gateways, and Fieldlinks carry requests, reports, and contact. The Asset
app owns motion and failsafes. No other component controls flight.

## Keep evidence honest

An accepted request and an observed result are different facts. Asset reports
are the observed outcome, not the same fact as acceptance. Receiving a report
does not prove fresh measurements or two-way contact. Preserve uncertainty when
the outcome is not known. Each subsystem defines how it represents that evidence.

State guarantees together with their assumptions and recovery boundaries. Make
retries safe so a repeated request never repeats an effect. Exact rules belong
in the Core API and Fieldlink docs.

## Keep shared data simple

The owner decides Atlas's data formats and data structures. Protocol follows them and adds the exact fields.

- Shared domain data lives in Protocol as records, such as Tasks, settings, and
  reports. Core, clients, gateways, and Assets use the same variables, names,
  units, and shapes. Local process configuration and diagnostic logs belong to
  the component that uses them; they are not Protocol contracts.
- Each record has one time for the whole record. Mixed times are rare and need
  their own case. Records about one Asset carry `asset_id`. Where it matters, a
  record has a field for who requested or reported it.
- Times are in milliseconds.
- Counters are ordinary numbers, not long numbers written as text.
- IDs that people read or that cross a field link are 1 to 4 letters or digits.
  Event IDs are integers. Assets choose `observation_id`; Core assigns the
  others, `asset_id` included ([Reset and identity](reset-and-identity.md#ids)).
- Records never carry credentials.
- Protocol's package version is its only version
  ([law 14](https://github.com/atlas-field-systems/atlas/blob/main/protocol/docs/laws.md)).
  Never silently reinterpret unsupported records or conceal incompatible
  behavior. Do not invent record fields for attribution or routing that Core or
  a gateway already owns.

## Document ownership

- This charter owns Atlas's purpose, operating context, project-wide principles,
  and end-to-end usage examples.
- Subsystem documentation owns its behavior, failure cases, and planning decisions.
- Protocol owns the exact shared records and the one validator within the charter's
  [shared data rules](#keep-shared-data-simple). No program builds a second
  validator. Core owns the Core API, the business rules, and server mechanisms.
  The SDK owns the client for that API.
  [Gateway](https://github.com/atlas-field-systems/atlas/tree/main/gateway)
  owns the gateway app, and
  [Fieldlink](https://github.com/atlas-field-systems/atlas/tree/main/fieldlink)
  owns each field link, both its ends.
  [Asset](https://github.com/atlas-field-systems/atlas/tree/main/asset)
  owns how an Asset behaves, and
  [Command Interface](https://github.com/atlas-field-systems/atlas/tree/main/command-interface)
  owns how the operator application works.
  [Simulations](https://github.com/atlas-field-systems/atlas/tree/main/simulations)
  owns the end-to-end simulations that test the parts together.
  [Atlas Tools](https://github.com/atlas-field-systems/atlas/tree/main/tools)
  owns ready setups for equipment, built from the other parts. Other
  components own their runtime details.

Keep each rule with its owner and link to it from other documents.
When a subsystem rule conflicts with the operating context, surface the mismatch
and resolve it explicitly. Neither document silently overrides the other.
Intended behavior is not proof of implementation.

## Keep judgment sharp

Coding agents uphold these fundamentals before changing Atlas. Subsystem AGENTS.md
files point here.

Fix the real hole. Adding a new concept, field, or mechanism to paper over a bug is
a design problem. Prefer deleting the wrong thing over layering a new one.

Name important domain distinctions early so first flight does not conflate them
(for example Observation versus Track). Keep untested shapes provisional until a
concrete story, consumer, or prototype establishes what the contract needs. Commit
an exact contract early only when postponing creates a specific, explainable
obstacle. Do not let an imagined future architecture indefinitely delay first
flight; do not let first-flight shortcuts define the whole architecture either.

An accepted [ADR](../docs/adr/README.md) beats every other page. How-it-works docs,
laws, and the Core API doc beat an implementation plan when they conflict. Change them on purpose, in a pull request the owner approves; do not
quietly diverge in code.

Core, gateways, Assets, and the libraries they use provide detailed diagnostic
logging from the start. Each program collects its own events and its libraries'
events for its Reset ZIP. Logging never blocks equipment control or request
handling, and every gap is listed in the archive. Their owning docs define
logging and configurable options; Protocol defines shared data, not a runtime
logging service.

Build small prototypes early to stress undecided ideas and sanity-test the
docs. Write what they find back into the spec and the owning docs. A prototype
proves nothing on its own; the docs stay the source.

Every coding agent reads and upholds this charter. The Charter is the **review standard**.
Reading or quoting it does not prove a change meets it. A change should make clear
what problem it solves, why this is the simplest credible fix, and what evidence
supports the claim.

## Test what matters

Tests exist to catch bugs. Count the bugs a test could catch, not the tests
written. AI agents write most of Atlas's code, and they overproduce tests that
check nothing, so these rules guard against that first.
[ADR-0019](../docs/adr/0019-simulations-prove-atlas-works-and-deep-modules-get-focused-tests.md)
records the owner's decision.

- **The docs are the answer key.** A test checks a rule that a page states, and
  names that page. Expected results come from the docs, ArduPilot SITL, and
  hardware. They never come from running the code under test, and tests are
  never generated from Protocol's definitions: a system and its tests made
  from the same source agree even when both are wrong. Protocol's examples test
  only record shapes and the validator.
- **Simulations prove Atlas works.** Behavior that crosses parts is tested by
  running the real parts together, through their public interfaces, in
  [Simulations](https://github.com/atlas-field-systems/atlas/tree/main/simulations).
  Every simulation can be repeated and leaves a record someone can check again.
- **Focused tests for deep modules.** Dense logic inside one part, such as
  failsafe rules, the Task queue, Protocol's validator, or storage and
  recovery, may have focused tests at that module's own interface, never its
  internals. Prefer deep modules, a small interface over a lot of behavior, so
  that logic is easy to test this way. Before adding one, say what behavior it
  protects, what realistic bug would make it fail, and why no existing test
  already catches that bug.
- **No tautological tests.** A test that repeats the code back to itself is
  deleted. That includes comparing a value with itself, searching source text,
  checking how code is called instead of what it does, expected values copied
  from the code's output, mocks that supply the behavior being checked, and
  hooks added to a part only so a test can reach inside it. Something the
  shipped program also passes in, such as its clock, is not such a hook.
- **The failing test comes first.** Every failure is first reproduced by a
  [test that fails](https://github.com/atlas-field-systems/atlas/blob/main/simulations/README.md#every-failure-becomes-a-test)
  for the right reason: a simulation when the failure crosses parts, or a test
  at the interface of the module it stays inside. The fix makes it pass, and it
  stays. One test per bug, not one at every layer the bug passed through.
- **Protect the check.** A change that fixes code never weakens the test that
  checks it. A test's expected result changes only after its page changes, in a
  change the owner can see. A check that cannot fail protects nothing, so break
  a rule on purpose now and then and confirm a test catches it.
- **Enforce in code, not prose.** A rule that CI, a lint, or a type can check is
  checked that way, as Atlas already checks lint rules, links, and retired
  phrases. A written rule is the fallback.
- **No flaky tests.** A test that sometimes fails with no change is a bug in the
  test or the part, fixed at once and never retried until it passes. Simulated
  time and recorded seeds make every simulation repeatable.
- **Say what was verified.** A result names what passed, what failed, and what
  was not checked. A simulated pass is labelled simulated and proves nothing
  about real flight or radios.

## Change Atlas deliberately

The owner approves behavior and scope. Engineers choose conforming details.
Keep selected decisions, proposals, and open questions distinct in subsystem docs.
Coding agents and their subagents follow this charter. When evidence shows an approved
assumption is wrong, the agent explains the mismatch and proposes the smallest
correction; the owner still decides. Generated output, reviews, and
historical specifications do not approve changes and do not override this charter.
