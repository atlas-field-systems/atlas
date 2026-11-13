import { readDefinitionFiles } from './node-definitions.mjs';
import { loadProtocol } from './browser.mjs';

export { loadProtocol } from './browser.mjs';

export async function loadPackagedProtocol() {
  return loadProtocol(await readDefinitionFiles());
}
