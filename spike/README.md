# Throwaway Atlas v2: do not merge

Built from current docs at `cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a`.
The branch started clean at that commit; remote main matched it. No earlier spike
was read, copied, or merged. All changes belong to `spike/`.

Requires Node 24.22 or later. From the repository root:

```sh
npm ci --prefix spike
npm run check --prefix spike
npm test --prefix spike
```

Tests start loopback HTTP servers with temporary SQLite databases, generate
fixture credentials, run clients and simulated Assets, and remove their data.
They use no hardware, SITL, CDN, or external service. The 100 MB boundary probe
allocates real buffers and stores them, so allow several hundred MB of memory.

`server.ts` runs Core. `client.ts` supplies HTTP calls, SSE iteration, and an
explicit yes/no answer for updating Tasks after editing a place. `asset.ts`
contains the app and independent flight-controller double. `gateway.ts` models
one gateway with relay paths and signed radio frames. `core.ts` owns SQLite
transactions and verified ZIP export. `protocol.ts` loads the repository's
validator and definitions as data. TypeScript projections describe only fields
this spike uses; they are not a replacement Protocol contract.

SIGKILL tests distinguish a crash from SIGTERM, which deliberately ends the run.
`SPIKE_CRASH_DURING_ARCHIVE=1` is an injection point used only to kill Core after
writing a temporary ZIP. A later normal start finishes the stop.

The suite contains 27 tests: 24 behavior tests, one Plugin validator-only check, and two
doc-conflict probes. The Plugin check is not an implemented Plugin service. Passing conflict probes reproduce an incompatibility; they are
not evidence that the product design works. See [lessons](lessons.md) for the
three separate finding categories, known limits, and owner questions.
