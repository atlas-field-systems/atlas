import { readFileSync } from 'node:fs';

export const VERSION = JSON.parse(readFileSync(new URL('../protocol/definitions/variables/protocol_version.json', import.meta.url), 'utf8')).examples[0];
