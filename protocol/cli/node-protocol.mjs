import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { deflateSync } from 'fflate';
import { loadProtocol } from '../lib/protocol.mjs';

export const definitionsDir = resolve(
  process.env.ATLAS_DEFINITIONS ?? join(fileURLToPath(import.meta.url), '../../definitions'));

export const load = () =>
  loadProtocol(async (f) => JSON.parse(await readFile(join(definitionsDir, f), 'utf8')), Ajv, addFormats);

export const compress = (bytes) => deflateSync(bytes, { level: 9 });
