import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

export const sitlDirectory = resolve(process.env.ATLAS_SITL_DIRECTORY ?? join(homedir(), '.cache/atlas-sitl'));
const base = 'https://firmware.ardupilot.org/Copter/stable/SITL_x86_64_linux_gnu';
const downloads = [
  ['arducopter', `${base}/arducopter`, 'caed35e4cb796ec06cac40b09566a18251771486b1cbac5e2bf16b7a5ed5045d'],
  ['copter.parm', 'https://raw.githubusercontent.com/ArduPilot/ardupilot/Copter-4.7.2/Tools/autotest/default_params/copter.parm', '5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e'],
];
await mkdir(sitlDirectory, { recursive: true });
for (const [name, url, hash] of downloads) {
  const path = join(sitlDirectory, name);
  let bytes = await readFile(path).catch(() => undefined);
  const digest = data => createHash('sha256').update(data).digest('hex');
  if (!bytes || digest(bytes) !== hash) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== hash) throw new Error(`${name}: SHA-256 mismatch; Copter 4.7.2 is pinned, refusing changed download`);
    const temporary = `${path}.partial`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  if (name === 'arducopter') await chmod(path, 0o755);
  process.stdout.write(`${name}: verified ${hash}\n`);
}
