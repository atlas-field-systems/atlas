import { deflateSync } from 'fflate';
import { readDefinitionFiles } from './node-definitions.mjs';
import { loadDefinitions } from './definitions.mjs';

export const load = async () =>
  loadDefinitions(await readDefinitionFiles(process.env.ATLAS_DEFINITIONS));

export const compress = (bytes) => deflateSync(bytes, { level: 9 });
