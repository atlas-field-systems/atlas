import { loadDefinitions } from './definitions.mjs';

export async function loadProtocol(files) {
  return (await loadDefinitions(files)).protocol;
}
