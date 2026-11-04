# Atlas Core

Atlas Core is the server that keeps the shared picture of a site and requests work from Assets. It stores data in the formats defined in Protocol and talks to gateways and apps through the SDK.

**First-flight prototype.** Built to learn fast; findings go back into Protocol and the Charter ([docs/findings.md](docs/findings.md)).

```sh
git clone --recurse-submodules https://github.com/atlas-field-systems/core && cd core && npm install && npm run demo
```

`npm run demo` starts Core, a simulated drone (A1) and an operator that flies the protocol's first flight. Open the printed address to watch the path. `docker build -t atlas-core . && docker run -p 8080:8080 atlas-core` does the same. `npm start` runs Core alone (see `src/main.mjs` for its settings). `npm test` runs the end-to-end tests.

- Charter: https://atlas-field-systems.github.io/atlas/
- Protocol (all data formats): https://github.com/atlas-field-systems/protocol, pinned as the `protocol/` submodule
- AI agents: read [AGENTS.md](AGENTS.md).
