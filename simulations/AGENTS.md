# Working on Atlas Simulations

Read the [root AGENTS.md](../AGENTS.md) first: the parts of Atlas, Charter first,
branches and releases, and the working rules live there.
Everything here is a [draft](../atlas/CHARTER.md#everything-is-a-draft).

## This folder

- End-to-end simulations of Atlas parts working together go here: the simulated
  world, the scenarios, the seeded fault runs, and their CI. Each part's own unit
  tests stay in that part's folder.
- A simulation checks a rule; it never states one. The rule lives on its owning
  page, and the scenario links to it. A rule a simulation needs that no page
  states is a gap in that page: fix the page.
- Run the real parts. Fake only the world around them, through what each part
  [takes from outside](README.md#what-each-part-allows). Never add a test-only
  path to a part.
- A simulated Asset runs only its script and makes no decision of its own
  ([simulated Assets](README.md#simulated-assets)).
- Never generate scenarios or expected results from Protocol's definitions
  ([test what matters](../atlas/CHARTER.md#test-what-matters)).
- In progress: the Core and SDK world and first scenarios are built.
  Remaining scenarios and seeded fault workloads follow.
- Do not merge without the developer's approval.

Run `npx tsc --noEmit` and `npm test`.
