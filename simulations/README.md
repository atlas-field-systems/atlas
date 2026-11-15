# Atlas Simulations

Atlas Simulations runs the real Atlas parts together in a simulated world and
checks that they work end to end. It is where Atlas's integration tests and
evals live. It is a test harness, not a product: nothing in it ships to a field.

**Built for Core, the SDK, and the initial Asset IP runtime.** The first version runs
[Protocol, Core, and the SDK](../atlas/decision-log.md#build-and-test) together.
[Core and SDK simulations](docs/core-and-sdk.md) lists its scenarios and fault rules.
[Asset simulations](docs/asset.md) covers real Asset acquisition and ArduPilot SITL.

## Real parts, simulated world

A simulation runs each Atlas part as it ships and fakes only what lies around
it.

| Real                                              | Simulated                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Core, with its SQLite storage and event log       | The network between programs: delays, lost requests, lost responses, dropped event streams, disconnects |
| The SDK, used by every simulated caller           | Scripted operators, gateways, Plugins, and remaining contract callers (see below)                              |
| Protocol's definitions and its one validator      | Time, so minutes of contact rules run in milliseconds                                                   |
| The initial Asset IP runtime | Equipment and vehicles, including ArduPilot SITL                                                 |
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

Asset behavior scenarios run the [real Asset app](../asset/README.md) with
simulated equipment ([Asset simulations](docs/asset.md)). Scripted operators,
gateways, and Plugins are other callers; they do not replace the Asset app.

The shared world helper, `src/asset-app.ts`, starts the production app with
`parseConfig`, world time, the simulated network, and world-owned storage. It
accepts equipment configuration, exposes identity and shutdown, and restarts
with the same key and optional configuration or clock changes. Public read
permission scenarios use a separate SDK reader with the app's credential;
reporting and Task execution stay with the app. Equipment-control scenarios
still own their TCP peers.

Migration is incomplete under the [owner's decision](../atlas/decision-log.md#build-and-test).
This table is the migration inventory; names under `scenarios/` end in `.test.ts`.
“Pending” means remaining migration work, not an approved scripted exception.

| Suite | Current Asset implementation |
| --- | --- |
| `admission` | Real app, paused settings Tasks fill the queue and Run now completes through the app. |
| `client-fences` | Real IP app; scripted radio remains because the gateway app and Fieldlink are not built. Its wrong-hash registration is deliberately invalid gateway traffic. |
| `open-reads` | Real IP apps; scripted radio remains because the gateway app and Fieldlink are not built. |
| `offline` | Real app, network partition, and settings Tasks. |
| `restarts` | Real app restart with the same key; unfinished work drops and a new settings Task completes. |
| `run-change` | Real IP app; scripted radio remains because the gateway app and Fieldlink are not built. |
| `wrong-clocks` | Real app restarted with a skewed world clock; no forged report. |
| `asset-rejoin` | Pending: direct SDK startup, outbox and queue control. |
| `current-state` | Pending: scripted report source. |
| `everything` | Pending: scripted IP and radio workload. |
| `full-disk` | Pending: scripted Asset requests during storage failure. |
| `gateways` | Pending classification: gateway and radio callers. |
| `helper-lifecycles` | Pending: direct SDK helper lifecycle control. |
| `lost-responses` | Pending: scripted mutations and retry bodies. |
| `picture-recovery` | Pending: scripted registration and equipment reports. |
| `places` | Pending: direct queue control and place updates. |
| `reports-gap` | Pending: scripted retained report history. |
| `review-regressions` | Pending: mixed SDK and raw caller regressions. |
| `review2-regressions` | Pending: mixed SDK and raw caller regressions. |
| `stream-contact` | Pending: direct registration creates stream traffic. |
| `tasks-link` | Pending: scripted radio delivery and queue control. |
| `faults/core-and-sdk.test.ts` | Pending: scripted Asset starts and final outcomes. |

The remaining IP scripts must be replaced before deleting `ipAsset` from
`src/actors.ts`. Radio Assets stay scripted until a real gateway app and
Fieldlink can carry their traffic. Scripted raw callers are retained only for
Core refusal conditions the app cannot produce; the remaining mixed suites
still need that classification.

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
| [Asset](docs/asset.md)               | The Asset app against ArduPilot SITL and simulated equipment                           |

## Open

- Gateway and Fieldlink simulations: simulated radios, frame loss, and capacity,
  once those parts are built.

AI agents: read [AGENTS.md](AGENTS.md).

## Run the Core and SDK scenarios

Use Node 24. Run `npm ci` in Protocol, Core, the SDK, Asset, and this folder, in that
order. Then run `npx tsc --noEmit` and `npm test` here. CI runs the built
scenarios and fixed fault seeds on each affected pull request.
The full-disk scenario mounts an 8 MiB tmpfs with passwordless sudo. If the host
cannot mount it, the test reports a skip with the mount error. The crash and stop
scenario uses a separate Core process and the real clock. ZIP checks require `unzip`.

Scenarios check their documentation anchors before running. A failed run writes
its trace, seed, assertion or cleanup error, and Core `logs/` under `.runs/`.
SITL cleanup attempts every registered resource in reverse order and reports collected
failures after all callbacks finish. A failed final Reset preserves the temporary
world directory and reports Core's
explanation. Node's test runner runs TypeScript directly. Each scenario supplies a name,
documentation anchors, and an asynchronous script. Seeded workloads run seeds
64, 100, and 121. `ATLAS_SEED=64 npm test` replays that fault seed alongside the
scenarios. Each network decision hashes the seed, caller, path, and that caller's
request count on the route. Workload choices use one seeded generator. Faults
therefore do not move between callers when I/O order changes.
Fault runs count starts observed by the scripted Assets, both pulled Tasks and
Run now callbacks. Every fault seed checks that seeded decisions cut both readers and lost
responses on at least two routes. The traffic log records whether each fault
came from a seed or an explicit scenario rule. Seeded runs place no faults by hand. Reader event IDs are compared with Core's
`events.jsonl` from the Reset ZIP after the run stops, using each reader's audience.

The clock fires timers in deadline order and preserves insertion order on ties.
World waits fail after ten wall-clock seconds with the in-flight request list.
A run cannot advance more than 24 simulated hours. `settle()` waits for eight
quiet event-loop turns with no request in flight. Open stream reads are excluded.
Arriving chunks and SDK diagnostics count as activity. Delayed requests remain
abortable, so SDK timeouts cancel the simulated delay.
