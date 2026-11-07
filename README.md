# Atlas

Atlas helps operators understand field systems, request work, and retain evidence.
This repository holds every part of it, one folder each:

- [atlas/](atlas/): the Charter, what Atlas is for and how its parts fit together. Start here.
- [protocol/](protocol/): shared messages and domain-storage formats.
- [sdk/](sdk/): the SDK, the one implementation every program uses. Docs only so far.
- [core/](core/): Atlas Core, the server. First-flight prototype.
- [asset/](asset/): how an Asset behaves. Planning.
- [command-interface/](command-interface/): the operator interface. Planning.

The Charter and the Protocol viewer are published at
https://atlas-field-systems.github.io/atlas/ (the viewer is under `protocol/`).

Work lands on `main`; approved releases go through `prod`. Protocol package
publishing is not configured yet. Its published package version will be its only version.
AI agents: read [AGENTS.md](AGENTS.md).
