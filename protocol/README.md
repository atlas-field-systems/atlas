# Atlas Protocol

Protocol defines Atlas's shared records, their laws, and the one validator every
program uses.

A record is a piece of shared data: an Asset's description, a Task, a
settings change, a cancel, or a report. Core, the SDK, gateways, and Assets all
build, check, and store the same records from these plain JSON files. Protocol
does not define how programs talk. The [Core API](../core/docs/api.md) carries
records over IP, and Fieldlinks carry them across field links. Local configuration
and diagnostic logs belong to the components that use them.

Protocol is an unpublished draft. Its package version will be its only version.
Definitions and records carry none.

## Records

| Record | What it is | Who makes it |
| --- | --- | --- |
| `description` | What an Asset is: its reports, command kinds, supported settings, subsystems, and cameras | Asset |
| `task` | One Task's body: a command kind and its fields, or a settings change | Core, for an operator |
| `settings_change` | Settings to change now | Core, for an operator |
| `cancel` | Cancel one Task | Core, for an operator |
| `provisioning` | An Asset or gateway was added or removed | Core, for an admin or a gateway |
| `contact` | Whether an Asset or gateway is in contact, and when it was last heard | Core, or a gateway for the Assets it carries |
| `report.status` | One subsystem's condition, one Task's state, or its task list | Asset |
| `report.telemetry`, `report.battery` | Where it is and how it moves; its battery | Asset |
| `report.settings` | Its settings' values | Asset |
| `report.failsafe` | A failsafe Task's state, an operator override, or a flight-controller takeover | Asset |

Each record has its own definition with a description and examples. Geo feature,
Object, Plugin, Observation and gimbal definitions are [parked](parked/README.md)
until they are reworked into records.

Requests are not records. `requests/` defines the bodies operators send to the
Core API: `tasks` (one or more Task kinds, or one with `now`) and `settings`.
Core stamps the record fields, such as `time`, `task_id`, and `requested_by`,
to make the `task` and `settings_change` records.

## Try it

- Web viewer: https://atlas-field-systems.github.io/atlas/protocol/
- From a clone (Node 22+), in `protocol/`: `npm ci && npm run cli`. Use `npm run site` for the web viewer at http://localhost:8080.

Pick a definition to see its description, its fields, an example, whether it is
valid, and its size (compact and compressed). Edit any field to see the effect.
Both tools only display what the definitions say. They never send anything.

## Layout

- `definitions/`: `variables/`, `components/`, `records/`, `requests/`, and `index.json`. The examples in each definition are the validator's test vectors.
- `docs/laws.md`: the rules every definition follows. `docs/decisions.md`: choices behind the records. `docs/open-questions.md`: what is not decided.
- `lib/`: shared viewer logic. `cli/`: terminal viewer. `site/`: web viewer.
- `scripts/check.mjs`: checks every definition and its examples (`npm ci && npm run check && npm test`).
- `parked/`: earlier definitions waiting to be reworked into records. Not checked.

The [SDK](../sdk/README.md) is the client for the Core API and loads these
definitions. AI agents: read [AGENTS.md](AGENTS.md).
