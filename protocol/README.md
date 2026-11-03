# Atlas Protocol

The single definition of every Atlas message, and the guide for how Atlas stores data.

It covers how data moves between parts of Atlas, and it guides how data is stored.
Core, the SDK cache, and Assets store data built from these same definitions.
Everything is described here, once, in plain JSON files.
Core, the SDK, Assets, and the tools all read from these files.
When we improve the protocol, everything that uses it improves.

A CLI and a web viewer show any message, its example, and its size.
They only display what the definitions say, so changing the protocol never means
changing the tools.

## Try it
- **Web viewer:** https://atlas-field-systems.github.io/protocol/
- **CLI, one command (Node 22+):** `npx -y github:atlas-field-systems/protocol`
- **From a clone:** `npm ci && npm run cli`. Use `npm run site` for the web viewer at http://localhost:8080.

Pick a definition, and you'll see its description, its fields, an example, whether
it's valid, its size (compact and compressed), and its largest fields. Edit any
field to see the effect. Both tools only display; they never send anything.

## Layout
- `definitions/`: variables, components, messages, and `index.json`
- `docs/laws.md`: the rules every message must follow
- `docs/decisions.md`: the decisions behind the format
- `lib/`: shared viewer logic. `cli/`: terminal viewer. `site/`: web viewer
- `scripts/check.mjs`: checks every definition and example (`npm ci && npm run check && npm test`)

AI agents: read [AGENTS.md](AGENTS.md). Undecided items: [docs/open-questions.md](docs/open-questions.md).
