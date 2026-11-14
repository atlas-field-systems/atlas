# Atlas Simulations

Atlas Simulations runs the real Atlas parts together in a simulated world and
checks that they work end to end. It is where Atlas's integration tests and
evals live. It is a test harness, not a product: nothing in it ships to a field.

**Built for Core and the SDK.** The first version runs
[Protocol, Core, and the SDK](../atlas/decision-log.md#build-and-test) together.
[Core and SDK simulations](docs/core-and-sdk.md) lists its scenarios and fault rules.

## Real parts, simulated world

A simulation runs each Atlas part as it ships and fakes only what lies around
it.

| Real                                              | Simulated                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Core, with its SQLite storage and event log       | The network between programs: delays, lost requests, lost responses, dropped event streams, disconnects |
| The SDK, used by every simulated caller           | Assets, until the Asset app exists ([simulated Assets](#simulated-assets))                              |
| Protocol's definitions and its one validator      | Time, so minutes of contact rules run in milliseconds                                                   |
| Later: the Asset app, the gateway app, Fieldlinks | Equipment, radios, and vehicles (later: ArduPilot SITL)                                                 |
|                                                   | Faults in the host: a full disk, a Core crash, a deliberate stop                                        |

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

## Every failure becomes a test

When Atlas fails, in a simulation, a prototype, or the field:

1. Write a test that makes the failure happen, and watch it fail. A failure
   that crosses parts gets a simulation. A failure inside one part's contract,
   such as the validator accepting a bad record, gets a test at that contract.
2. If the failure shows a page was wrong or silent, fix the page first. The
   docs are the source, and the test cites them.
3. Fix the part, and watch the test pass.
4. Keep the test. It runs on every change from then on.

## Rules

Simulations follow the Charter's [Test what matters](../atlas/CHARTER.md#test-what-matters),
including that a simulated pass proves nothing about real flight or radios.

## Docs

| Doc                                  | Covers                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| [Core and SDK](docs/core-and-sdk.md) | The first version: Core and the SDK under a faulty network, with simulated Assets, gateways, Plugins, and operators |
| [Asset](docs/asset.md)               | The Asset app against ArduPilot SITL and simulated equipment, once the Asset app is built                           |

## Open

- Gateway and Fieldlink simulations: simulated radios, frame loss, and capacity,
  once those parts are built.

AI agents: read [AGENTS.md](AGENTS.md).

## Run the Core and SDK scenarios

Use Node 24. Run `npm ci` in Protocol, Core, the SDK, and this folder, in that
order. Then run `npx tsc --noEmit` and `npm test` here. CI runs the built
scenarios and fixed fault seeds on each affected pull request.
The full-disk scenario mounts an 8 MiB tmpfs with passwordless sudo. If the host
cannot mount it, the test reports a skip with the mount error. The crash and stop
scenario uses a separate Core process and the real clock. ZIP checks require `unzip`.

Scenarios check their documentation anchors before running. A failed run writes
its trace, seed, assertion error, and Core `logs/` under `.runs/`. Node's test runner runs TypeScript directly. Each scenario supplies a name,
documentation anchors, and an asynchronous script. Seeded workloads run seeds
7, 42, and 2026. `ATLAS_SEED=42 npm test` replays that fault seed alongside the
scenarios. Each network decision hashes the seed, caller, path, and that caller's
request count on the route. Workload choices use one seeded generator. Faults
therefore do not move between callers when I/O order changes.
Every fault seed checks that both readers had a stream cut and that responses
were lost on at least two routes. Reader event IDs are compared with Core's
`events.jsonl` from the Reset ZIP after the run stops, using each reader's audience.

The clock fires timers in deadline order and preserves insertion order on ties.
World waits fail after ten wall-clock seconds with the in-flight request list.
A run cannot advance more than 24 simulated hours. `settle()` waits for eight
quiet event-loop turns with no request in flight. Open stream reads are excluded.
Arriving chunks and SDK diagnostics count as activity.
