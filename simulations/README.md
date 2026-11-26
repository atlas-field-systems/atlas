# Atlas Simulations

Atlas Simulations runs the real Atlas parts together in a simulated world and
checks that they work end to end. It is where Atlas's integration tests and
evals live. It is a test harness, not a product: nothing in it ships to a field.

**Built for Core, the SDK, and the initial Asset IP runtime.** The first version runs
[Protocol, Core, and the SDK](../docs/adr/0003-build-each-part-whole-one-part-at-a-time.md) together.
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
reporting and Task execution stay with the app. For equipment, it takes the
shared simulated ArduPilot (`src/ardupilot-peer.ts`) or a TCP reporting
peripheral (`src/peripheral.ts`). Without either, the app is stationary and runs
its control loop once a second. Failsafe and takeover scenarios still
script their own ArduPilot peers to time each mode change.

Every IP Asset doing Asset work in a scenario is the real app, as the
[owner decided](../docs/adr/0019-simulations-prove-atlas-works-and-deep-modules-get-focused-tests.md). Two kinds of scripted
caller remain, and neither stands in for the Asset app:

- **Radio Assets** (`radioAsset` in `src/actors.ts`) behind a scripted
  gateway. The real app has no radio link until the gateway app and a Fieldlink
  exist; these move to the app then.
- **Contract callers** (`sdkAssetCaller`, and raw Core calls) check a contract
  the app cannot reach: the SDK's public Asset helpers, which any program on IP
  may use (a caller-supplied diagnostic observer, retry backoff, synchronous
  queue transitions, explicit report lanes, a gimbal declaration), and Core's
  refusal of traffic the app never sends (a wrong definitions hash, a late
  report contradicting a final Task state, a changed body on a replayed
  request).

Names under `scenarios/` end in `.test.ts`.

| Suite | Asset in the scenario |
| --- | --- |
| `admission` | Real app; paused settings Tasks fill the queue and Run now completes through the app. |
| `asset-rejoin` | Real app; settings Task completion and a lost-response retry keep final reports unchanged. |
| `client-fences` | Real IP app and radio Asset. Its wrong-hash registration is a raw caller. |
| `current-state` | Real app with a TCP reporting peripheral; a change reports once, then the heartbeat. |
| `everything` | Real IP apps with a separate SDK reader on the app's credential. |
| `full-disk` | Real apps; a full Core disk refuses startup and peripheral captures without partial events. |
| `gateways` | Real IP app and radio Assets. |
| `helper-lifecycles` | Real app for the startup handshake retry; SDK contract callers for consumer, consumer-error, and retained-lane lifecycles. |
| `lost-responses` | Real app generates reports and retries; a raw changed-body replay checks the idempotency refusal. |
| `offline` | Real app, network partition, and settings Tasks. |
| `open-reads` | Real IP apps and a radio Asset. |
| `picture-recovery` | Real apps for snapshot recovery; an SDK contract caller declares a gimbal and changing equipment. |
| `places` | Real IP apps; paused queues and a network partition exercise place updates. |
| `reports-gap` | Real app catches up detector Observations with acquisition times intact; an SDK contract caller checks live-versus-retained lane order. |
| `restarts` | Real app restart with the same key; unfinished work drops and a new settings Task completes. |
| `review-regressions` | Real apps for the filtered picture, storage-refusal retry, and late final evidence; contract callers, a radio Asset, and non-Asset callers for the rest. |
| `review2-regressions` | SDK contract callers for diagnostic observer order and retry backoff; non-Asset callers for the rest. |
| `run-change` | Real IP app and a radio Asset. |
| `stream-contact` | Real app; keepalives advance contact and closing keeps the hear time. |
| `tasks-link` | Radio Asset: radio Task delivery and queue control. |
| `wrong-clocks` | Real app restarted with a skewed world clock. |
| `faults/core-and-sdk.test.ts` | Real IP apps execute Holds through simulated ArduPilot; a radio Asset alongside. |

## Two kinds of eval

- **Scenarios.** A scripted story with an expected outcome, such as "Tasks
  queued while paused, and Run now still runs". Each scenario names the rule it checks and
  links to the page that owns it. The owning page states the rule; the scenario
  only checks it.
- **Seeded fault runs.** Many runs with random faults, each repeatable from its
  seed, that check rules which must hold whatever happens. For example: a
  `task_id` never runs twice, every accepted request ends in a reported outcome
  or a visible drop, a reader never misses or repeats an event, and nothing is
  stored without its event. Fault runs find failures; a scenario pins each one
  down.

Every simulation is repeatable. A failure keeps its seed, inputs, expected and
observed results, and each part's diagnostics, so it reproduces on any
computer.

## Every failure becomes a test

When Atlas fails, in a simulation, a prototype, or the field:

1. Write a test that makes the failure happen, and watch it fail. A failure
   that crosses parts gets a simulation. A failure inside one part, such as
   the validator accepting a bad record, gets a test at the interface of the
   module it stays inside.
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

From the repository root, run `npm run setup -- simulations` and
`npm run check -- simulations` ([workspace commands](../README.md#check-a-change)).
Alternatively, after setup run `npx tsc --noEmit` and `npm test` here. CI runs the built
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
Fault runs count Task starts: each real app's active Holds reaching its
simulated equipment, and the radio Asset's pulled Tasks and Run now callbacks. Every fault seed checks that seeded decisions cut both readers and lost
responses on at least two routes. The traffic log records whether each fault
came from a seed or an explicit scenario rule. Seeded runs place no faults by hand. Reader event IDs are compared with Core's
`events.jsonl` from the Reset ZIP after the scenario stops, using each reader's audience.

The clock fires timers in deadline order and preserves insertion order on ties.
World waits fail after ten wall-clock seconds with the in-flight request list.
A scenario cannot advance more than 24 simulated hours. `settle()` waits for eight
quiet event-loop turns with no request in flight. Open stream reads are excluded.
Arriving chunks and SDK diagnostics count as activity. Delayed requests remain
abortable, so SDK timeouts cancel the simulated delay.

## Run the demo

From the repository root, run `npm run setup -- simulations`, then `npm run demo`.
The demo runs the existing `asset-rejoin` scenario and its assertions. It uses
the real Core, SDK, and Asset app, with a simulated TCP peripheral, clock, and
network. An operator sends a settings Task; the Asset reports completion, loses
the acknowledgement, and reconnects. Core must record that completion once.
This is not an ArduPilot flight or a radio simulation.

Every invocation prints a new `simulations/.runs/demo-*` evidence directory:

- `summary.md`: PASS or FAIL, the intended checks, and observed Task reports.
- `events.jsonl`: domain events seen by the operator's event reader.
- `archive/`: Core's verified Reset ZIP, including the complete event log.
- `asset-archives/`: the Asset's verified Reset ZIP.

The command fails if an assertion or archive export fails. An early startup
failure may leave no summary; the terminal output explains it. A shutdown
failure may leave incomplete evidence. Only archive folders are copied from
the temporary world, not its credential files or live database. Once inspected,
the printed demo directory may be removed. CI runs the demo and uploads its
evidence alongside scenario failures.
