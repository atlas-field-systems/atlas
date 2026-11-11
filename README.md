# Atlas

Atlas helps operators understand field systems, request work, and retain evidence.
This repository holds every part of it, one folder each:

- [atlas/](atlas/): the Charter, what Atlas is for and how its parts fit together, and the
  [decision log](atlas/decision-log.md) of the owner's decisions. Start here.
- [protocol/](protocol/): the shared records and the one validator.
- [sdk/](sdk/): the client for the Core API. Docs only so far.
- [core/](core/): Atlas Core, the server, and the [Core API](core/docs/api.md). Planning.
- [asset/](asset/): how an Asset behaves. Planning.
- [command-interface/](command-interface/): the operator interface. Planning.
- [gateway/](gateway/): the gateway app and its Fieldlinks. Planning; what every Fieldlink provides is designed, the rest deferred.

The Charter and the Protocol viewer are published at
https://atlas-field-systems.github.io/atlas/ (the viewer is under `protocol/`).

Work lands on `main`; approved releases go through `prod`. Protocol package
publishing is not configured yet. Its published package version will be its only version.
AI agents: read [AGENTS.md](AGENTS.md).
