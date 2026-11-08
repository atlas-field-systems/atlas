# Atlas Core

Atlas Core is the server that keeps the shared picture of a site and requests work from Assets. It stores data in the formats defined in Protocol and talks to gateways and apps through the SDK.

**Retained first-flight prototype.** It uses a historical Protocol snapshot and
does not implement the current docs. Whether to keep or replace it is undecided;
no new runtime work is planned until the owner requests the prototype pass.
Findings live in [docs/findings.md](docs/findings.md).

[Request admission](docs/requests.md) records Core's checks before forwarding work.
[Fusion](docs/fusion.md) records processing Observations with other information,
including terrain reference data. Both describe selected future behavior.

The future runtime's [configuration inventory](config.md) and
[logging requirements](docs/logging.md) are discussion drafts, separate from the
retained prototype's options below.

```sh
git clone https://github.com/atlas-field-systems/atlas && cd atlas/core && npm install && npm run demo
```

`npm run demo` starts Core, a simulated drone (A1) and an operator that flies the protocol's first flight. Open the printed address to watch the path. `npm run protocol && docker build -t atlas-core . && docker run -p 8080:8080 atlas-core` does the same. `npm start` runs Core alone (see `src/main.mjs` for its settings). `npm test` runs the tests.

- Charter: https://atlas-field-systems.github.io/atlas/
- Protocol (all data formats): https://github.com/atlas-field-systems/atlas/tree/main/protocol. Core pins one Protocol release tag in `package.json` (`"protocol"`); `npm run protocol` unpacks it into `protocol/`
- AI agents: read [AGENTS.md](AGENTS.md).
