# Atlas

Atlas helps operators understand field systems, request work, and retain evidence.
This repository holds every part of it, one folder each:

- [atlas/](atlas/): the Charter, what Atlas is for and how its parts fit together. Start here.
- [protocol/](protocol/): every Atlas data format.
- [sdk/](sdk/): the SDK, the one implementation every program uses. Docs only so far.
- [core/](core/): Atlas Core, the server. First-flight prototype.
- [asset/](asset/): how an Asset behaves. Planning.
- [command-interface/](command-interface/): the operator interface. Planning.

The Charter and the Protocol viewer are published at
https://atlas-field-systems.github.io/atlas/ (the viewer is under `protocol/`).

Work lands on `main`. Pushing `main` to `prod` releases the parts that changed.
AI agents: read [AGENTS.md](AGENTS.md).
