# Atlas Protocol

Protocol defines Atlas's shared records, their laws, and the one validator every
program uses.

A record is a piece of shared data: an Asset's description, a Task, a
settings change, a cancel, a report, a Track, or a geo feature. Core, the SDK, gateways, and Assets all
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
| `task` | One Task's body, including Capture, or a settings change | Core, for an operator |
| `settings_change` | Settings to change now | Core, for an operator |
| `cancel` | Cancel one Task | Core, for an operator |
| `registration` | An Asset registered in the run or was removed from it | Core, for the Asset, its gateway, or an admin |
| `provisioning` | An admin provisioned or removed a gateway or Plugin | Core, for an admin |
| `contact` | Whether an Asset, gateway, or Plugin is in contact, and when it was last heard | Core, or a gateway for the Assets it carries |
| `drop` | A Task, request, or Plugin call Core stopped waiting on | Core |
| `refusal` | A caller or radio Core refused for a different definitions hash | Core |
| `report.status` | One subsystem's condition, one Task's state, or its task list | Asset |
| `report.telemetry`, `report.battery` | Where it is and how it moves; its battery | Asset |
| `report.gimbal` | Where each gimbal camera points | Asset |
| `report.settings` | Its settings' values | Asset |
| `report.failsafe` | A failsafe Task's state, an operator override, or a flight-controller takeover | Asset |
| `report.observation` | Something the Asset sees: where it is, or which way | Asset |
| `track` | Fusion's conclusion about one target, and the Observations it rests on | Core's Fusion |
| `geofeature` | A place on the map: a point, line, area, or GeoTIFF imagery, with an optional name | Core, for an account, Plugin, or Asset |
| `object` | A file Core holds: its name, type, size, and geo feature | Core, for an account, Plugin, or Asset |
| `deletion` | An Object was deleted | Core, for an operator |
| `plugin.description` | A Plugin's name and the actions it offers, with their inputs | Plugin |
| `plugin.call` | One call of a Plugin action, with its input values | Core, for an operator |
| `plugin.result`, `plugin.failure` | A Plugin's answer: places, facts, and what it created; or why it failed | Plugin |

Each record has its own definition with a description and examples. Plugins
describe their own actions from Protocol's common input kinds, so Protocol
lists no actions.

Requests are not records. `requests/` defines the bodies callers send to the
Core API: `tasks` (one or more Task kinds, or one with `now`), `settings`,
`geofeature`, `plugin_call`, `asset`, with which an Asset on IP registers, and `radio`, with which a gateway registers a radio Asset. Core stamps the record fields, such as `time`, `task_id`,
`geofeature_id`, and `requested_by`, to make the `task`, `settings_change`,
`geofeature`, and `plugin.call` records, and assigns `asset_id` to make the
`description` record.

## Use the library

Node programs use the package's own definitions:

```js
import { loadPackagedProtocol } from '@atlas/protocol';

const protocol = await loadPackagedProtocol();
const result = protocol.check('requests.tasks', body);
if (!result.ok) {
  const explanation = result.problems.map(({ path, message }) => `${path}: ${message}`).join('; ');
}
```

Load once and reuse the returned Protocol. `hash` is the definitions hash from
[the exact-byte recipe](docs/decisions.md#definitions-hash). `names` lists every
checkable record and request, using [law 5's names](docs/laws.md), such as `task`,
`report.status`, `plugin.result`, and `requests.tasks`. Kind files are checked
through their record, not as separate names.

`check(name, value)` returns `{ ok: true }` or
`{ ok: false, problems: [{ path, message }] }`. Each path is a JSON Pointer into
the value, including the name of a missing or extra field. The empty path means
the whole value. Messages are short explanations for callers to display.
An unknown name throws because it is a programming error. Validation leaves the
value unchanged.

Browser programs import `loadProtocol` from `@atlas/protocol/browser`. Node also
exports it from `@atlas/protocol`. It takes a `Map<string, Uint8Array>` containing
every JSON file under `definitions/`, including `index.json`. Keys are relative
paths with `/` separators; values are the exact file bytes. Supply these files
with the application, preserving their bytes. The loader performs no I/O and uses
`globalThis.crypto.subtle` for SHA-256. It returns `Promise<Protocol>`.
`loadPackagedProtocol()` also returns `Promise<Protocol>` and always reads this
package's own folder, independent of the working directory or environment.

Both entries are JavaScript ESM with hand-written declarations for this API.
They define no TypeScript record types. Protocol remains unpublished; programs
use it from this repository under the [release policy](../atlas/design-decisions.md#changes-and-releases).

## Try it

- Web viewer: https://atlas-field-systems.github.io/atlas/protocol/
- From a clone (Node 22+), in `protocol/`: `npm ci && npm run cli`. Use `npm run site` for the web viewer at http://localhost:8080.

Pick a definition to see its description, its fields, an example, whether it is
valid, and its size (compact and compressed). Edit any field to see the effect.
Both tools only display what the definitions say. They never send anything.

## Layout

- `definitions/`: `variables/`, `components/`, `records/`, `requests/`, and `index.json`. The examples in each definition are the validator's test vectors.
- `docs/laws.md`: the rules every definition follows. `docs/decisions.md`: working choices behind the records, below the [decision log](../atlas/decision-log.md). `docs/open-questions.md`: what is not decided.
- `lib/`: the validator, loaders, API declarations, and shared viewer display helpers. `cli/`: terminal viewer. `site/`: web viewer.
- `scripts/check.mjs`: checks every definition and its examples (`npm ci && npm run check && npm test`).

The [SDK](../sdk/README.md) is the client for the Core API and loads these
definitions. AI agents: read [AGENTS.md](AGENTS.md).
