# Atlas Simulations

Atlas Simulations runs the real Atlas parts together in a simulated world and
checks that they work end to end. It is where Atlas's integration tests and
evals live. It is a test harness, not a product: nothing in it ships to a field.

**Planning.** Nothing is built. The first version simulates
[Protocol, Core, and the SDK](../atlas/decision-log.md#build-and-test) together
([Core and SDK simulations](docs/core-and-sdk.md)).

## Real parts, simulated world

A simulation runs each Atlas part as it ships and fakes only what lies around
it.

| Real | Simulated |
| --- | --- |
| Core, with its SQLite storage and event log | The network between programs: delays, lost requests, lost responses, dropped event streams, disconnects |
| The SDK, used by every simulated caller | Assets, until the Asset app exists ([simulated Assets](#simulated-assets)) |
| Protocol's definitions and its one validator | Time, so minutes of contact rules run in milliseconds |
| Later: the Asset app, the gateway app, Fieldlinks | Equipment, radios, and vehicles (later: ArduPilot SITL) |
| | Faults in the host: a full disk, a Core crash, a deliberate stop |

A simulation never runs a special build of a part. If a part has to behave
differently to be simulated, the simulation proves less, so that need is a
design problem in the part.

## What each part allows

A part takes from outside the few things a simulation must control. The program
that ships passes the real ones; a simulation passes simulated ones. Nothing
else differs.

- **Its clock.** Core and the SDK read the time only from a clock they are
  given at start. Every timeout, keepalive, and contact rule, such as
  `offline_after_s`, uses that clock.
- **Its connection.** The SDK reaches Core through a connection it is given, so
  a simulation can put a faulty link between them.
- **Its storage location.** Core runs on a data directory a simulation creates
  and can fill.

Core's crash and stop scenarios run Core as its own process, on the real clock,
and kill or stop it.

## Simulated Assets

Until the [Asset app](../asset/README.md) exists, a simulated Asset is a script
built on the SDK's [Asset helpers](../sdk/docs/asset.md): the startup sequence,
the report outbox, and the queue helper. It does only what its scenario tells
it, such as "report Task 2 completed" or "go silent for 60 s". It makes no
decision of its own, so it never becomes a second Asset app that drifts from
the real one. Scripted Assets are temporary. When the Asset app exists, every
simulation that uses one is reworked to run the real Asset app with simulated
equipment ([Asset simulations](docs/asset.md)), and the scripted Assets are
deleted.

## Two kinds of eval

- **Scenarios.** A scripted story with an expected outcome, such as "64 Tasks
  queued, and Run now still runs". Each scenario names the rule it checks and
  links to the page that owns it. The owning page states the rule; the scenario
  only checks it.
- **Seeded fault runs.** Many runs with random faults, each repeatable from its
  seed, that check rules which must hold whatever happens. For example: a
  `task_id` never runs twice, every accepted request ends in a reported outcome
  or a visible drop, a reader never misses or repeats an event, and nothing is
  stored without its event. Fault runs find failures; a scenario pins each one
  down.

Every run is repeatable. A failure keeps its seed, inputs, expected and
observed results, and each part's diagnostics, so it reproduces on any
computer.

## Every failure becomes a simulation

When Atlas fails, in a simulation, a prototype, or the field:

1. Write a simulation that makes the failure happen, and watch it fail.
2. If the failure shows a page was wrong or silent, fix the page first. The
   docs are the source, and the simulation cites them.
3. Fix the part, and watch the simulation pass.
4. Keep the simulation. It runs on every change from then on.

## Simulated is not real

A simulated pass proves that the parts agree under the conditions simulated. It
does not prove real flight, radio performance, or mesh routing. Reports from a
simulation always say they are simulated. Hardware testing is still needed.

Simulations follow [tests come from behavior](../atlas/design-decisions.md#tests-come-from-behavior):
scenarios come from the rules the owner states in each part's docs, never from
Protocol's definitions.

## Docs

| Doc | Covers |
| --- | --- |
| [Core and SDK](docs/core-and-sdk.md) | The first version: Core and the SDK under a faulty network, with simulated Assets, gateways, Plugins, and operators |
| [Asset](docs/asset.md) | The Asset app against ArduPilot SITL and simulated equipment, once the Asset app is built |

## Open

- Test tools, the scenario format, and how fault runs pick their faults.
- Which simulations run on every pull request and which run on a schedule.
- Gateway and Fieldlink simulations: simulated radios, frame loss, and capacity,
  once those parts are built.

AI agents: read [AGENTS.md](AGENTS.md).
