// Entry point for the Protocol validator embedded in the Go executable.
import { loadProtocol } from "../../protocol/lib/browser.mjs";
import corePackage from "../package.json";
import protocolPackage from "../../protocol/package.json";
import { EVENT_KINDS } from "../src/api/event-kinds.ts";

const definitions = new Map(JSON.parse(globalThis.definitionFiles).map(([name, text]) =>
  [name, new TextEncoder().encode(text)]));
globalThis.ready = loadProtocol(definitions).then(protocol => {
  for (const { record } of Object.values(EVENT_KINDS)) {
    if (!protocol.names.includes(record)) throw new Error(`Missing Protocol record ${record}`);
  }
  for (const name of protocol.names) {
    if (name.startsWith("report.") && !Object.hasOwn(EVENT_KINDS, name)) throw new Error(`Missing event kind ${name}`);
  }
  globalThis.validate = (name, text) => JSON.stringify(protocol.check(name, JSON.parse(text)));
  return JSON.stringify({
    versions: {
      core_version: corePackage.version,
      protocol_version: protocolPackage.version,
      definitions_hash: protocol.hash,
    },
    events: EVENT_KINDS,
  });
});
