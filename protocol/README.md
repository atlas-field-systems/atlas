# Atlas Protocol

The single definition of every Atlas message.

Every message Atlas sends is described here, once, in plain JSON files.
Core, the SDK, Assets, and the tools all read from these files.
When we improve the protocol, everything that uses it improves.

A CLI and a web viewer (coming soon) show any message, its example, and its size.
They only display what the definitions say, so changing the protocol never means
changing the tools.

## Layout
- `definitions/`: variables, components, messages, and `index.json`
- `docs/decisions.md`: the decisions behind the format
- `scripts/check.mjs`: checks every definition and example (`npm ci && npm run check`)
