# Atlas

Atlas helps an operator watch drones and sensors, request work, and retain the
evidence of what happened. This repository holds every part of the system.

An operator application sends Tasks through the SDK to Core. Core keeps the
shared picture and forwards the work to an Asset, directly over IP or through
a gateway and Fieldlink. The Asset controls its equipment and reports observed
outcomes back to Core. Protocol defines the records they share.

## Start here

Use **Node 24 and npm on Linux**. The full checks also use `unzip` and
`systemd-analyze`; the Asset service expects Node at `/usr/bin/node`.
The full-disk simulation needs permission to mount tmpfs through passwordless
sudo. Without that permission it reports a skip, not a verified disk-full case.
Setup downloads npm dependencies. ArduPilot SITL is a separate, pinned download
for Linux x86-64.

From the repository root:

```sh
npm run setup
npm run demo
```

Setup installs each package's locked dependencies in order, including the docs
site. The demo runs real Core, SDK and Asset code with simulated equipment,
network and time. It demonstrates a settings Task completing across a lost
acknowledgement and reconnection. It needs no radio, flight controller, account
setup, or sudo. It prints the result and a fresh evidence directory containing
a readable summary and verified run archives. See [the demo](simulations/README.md#run-the-demo).

## Check a change

```sh
npm run check
npm run check:sitl
```

`check` runs documentation checks, type checks, package tests, non-SITL
simulations, and docs-site builds. It stops on failure. Read the test summaries
for skipped cases. `check:sitl` downloads or verifies the pinned ArduPilot
simulator and runs the flight scenarios separately; its evidence is simulated,
not hardware verification.

For a focused change, use `npm run setup -- sdk` to install the SDK and its
dependencies, then `npm run check -- sdk`. Targets are `protocol`, `core`,
`sdk`, `asset`, `simulations`, and `site`; `check` also accepts `docs`.
Component-local commands still work. CI uses these same focused checks.

## Find the right place

| I want to… | Start here |
| --- | --- |
| Understand the purpose and boundaries | [Goal](atlas/goal.md), [Charter](atlas/CHARTER.md), [design decisions](atlas/design-decisions.md) |
| Find an owner decision or the next milestone | [ADRs](docs/adr/README.md), [build order](atlas/build-order.md) |
| Change a shared record or its validation | [Protocol](protocol/README.md) |
| Change server behavior or understand an endpoint | [Core](core/README.md), [Core API](core/docs/api.md) |
| Call Core from a program | [SDK](sdk/README.md) |
| Change equipment behavior, Tasks, or failsafes | [Asset](asset/README.md) |
| Add or replay an end-to-end scenario | [Simulations](simulations/README.md) |
| Work on the operator application | [Command Interface](command-interface/README.md) |
| Work on a gateway or radio transport | [Gateway](gateway/README.md), [Fieldlinks](fieldlink/README.md) |

Each component's README owns its implementation status and links to its gaps
and verification evidence. Intended behavior in a design page is not proof
that it is implemented. [Historical plans](atlas/archive/README.md) are not
current requirements.

## Find local output

| Output | Location |
| --- | --- |
| Demo summary, domain events, Core and Asset archives | A new `simulations/.runs/demo-*` directory, printed by the command |
| Failed non-SITL scenarios | `simulations/.runs/`, with the scenario name and seed |
| SITL flight evidence | The `atlas-sitl-flight-*` directory under the system temporary directory, printed by the scenario |
| Downloaded SITL binary and parameters | `~/.cache/atlas-sitl`, or `ATLAS_SITL_DIRECTORY` |
| Built documentation | `atlas/site/_site` and `protocol/_site` |

These are local, ignored outputs. When no check is running, you may remove
individual demo/failure directories or site builds you no longer need. Keep
evidence you want to investigate. Removing the SITL cache requires downloading
it again. Normal successful non-demo scenarios remove their temporary worlds.

For standalone programs, choose explicit local data, log, and archive paths:
[Core configuration](core/config.md) and [Asset configuration](asset/config.md)
explain them. The demo provisions its own temporary Core and credentials.

## Contribute

Read [AGENTS.md](AGENTS.md) and the affected folder's rules before making changes.
Work lands on `main` through PRs; approved releases go through `prod`.
The published [Charter and Protocol viewer](https://atlas-field-systems.github.io/atlas/)
provide another way to browse the docs.
