import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packaged = fileURLToPath(new URL('../definitions/', import.meta.url));

export async function readDefinitionFiles(root = packaged) {
  const paths = (await readdir(root, { recursive: true })).filter((path) => path.endsWith('.json'));
  return new Map(await Promise.all(paths.map(async (path) =>
    [path.replaceAll('\\', '/'), new Uint8Array(await readFile(join(root, path)))])));
}
