---
status: accepted
date: 2026-11-11
---

# Plugins describe their own actions and never direct Assets

Each Plugin describes its own actions and display choices, so the Command Interface can show them without changing for every Plugin. Help text is optional. Menu entries and map display stay off unless the Plugin enables them. Adding or removing a Plugin is the only setup an admin needs to do.

Plugins supply information and never direct Assets. They can create Objects and geo features, with create-only rights on geo features. Suggested routes and automatically repeated calls are out of scope.

Rules: [Actions](../../atlas/plugins.md#actions), [Not Plugins](../../atlas/plugins.md#not-plugins), [Plugins](../../core/docs/api.md#plugins)
