---
status: accepted
date: 2026-11-12
---

# Behavior values live in each Asset's configuration

Every value that shapes an Asset's behavior lives in that Asset's own configuration, including arrival tolerances, command timeouts, and shutdown waits. Assets with different setups respond differently, so each value can be set per Asset. Atlas ships sensible defaults, and an Asset's configuration lists only what differs from them. Every value in use can still be seen.

Configuration changes need a restart. A value an operator tunes during an operation is a live setting, not configuration.

Rules: [Asset configuration](../../config.md)
