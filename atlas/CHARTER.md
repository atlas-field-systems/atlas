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

The owner decides these data rules. Protocol follows them and adds the exact fields.

- Each message has one time for the whole message. Mixed times are rare and need
  their own case. There is no sender field; messages carry `asset_id`, `time`, and `seq`.
- Times are in milliseconds. Only specialized radio data uses nanosecond timing.
- Counters are ordinary numbers, not long numbers written as text.
- The protocol guides storage. Core, the SDK cache, and Assets store data built
  from the protocol's definitions: same variables, names, units, and shapes.
  Storage may add its own fields and combined views, defined in the protocol too,
  but never conflicts with it.

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

## Change Atlas deliberately

The owner approves behavior and scope. Engineers choose conforming details.
Keep selected decisions, proposals, and open questions distinct in subsystem docs.
Generated output, reviews, and historical specifications do not approve changes.
