import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const run = promisify(execFile);

test('TypeScript consumers reject misspelled fields and kinds and narrow variants (docs/decisions.md#typescript-types)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-types-'));
  try {
    await mkdir(join(directory, 'node_modules/@atlas'), { recursive: true });
    await symlink(fileURLToPath(new URL('../', import.meta.url)), join(directory, 'node_modules/@atlas/protocol'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    const consumer = join(directory, 'consumer.ts');
    await writeFile(consumer, `
import type { ProtocolTypes } from '@atlas/protocol/types';
type Task = ProtocolTypes['task'];
type Status = ProtocolTypes['report.status'];
type Tasks = ProtocolTypes['requests.tasks'];
const task: Task = {time:1, asset_id:'A1', task_id:1, requested_by:'OP1', kind:'move_to', destination:{latitude:1,longitude:2}};
const status: Status = {type:'report.status',time:1,asset_id:'A1',kind:'task',task_id:1,task_state:'active'};
const request: Tasks = {tasks:[{kind:'hold'}]};
function use(task: Task, report: Status | ProtocolTypes['report.battery']) {
  switch(task.kind) {
    case 'move_to': task.destination?.latitude; break;
    case 'takeoff': task.target_altitude.altitude_m; break;
  }
  if(report.type === 'report.status' && report.kind === 'task') report.task_state;
}
// @ts-expect-error Unknown task kind.
const badKind: Task = {...task, kind:'fly'};
// @ts-expect-error Unknown task field.
const badField: Task = {...task, destnation:{latitude:1, longitude:2}};
// @ts-expect-error Wrong field type.
const badTime: Task = {...task, time:'yesterday'};
// @ts-expect-error Unknown status kind.
const badStatus: Status = {...status, kind:'unknown'};
// @ts-expect-error Unknown status field.
const badStatusField: Status = {...status, task_sate:'active'};
// @ts-expect-error Wrong grouped record type.
const badType: Status = {...status, type:'report.battery'};
// @ts-expect-error Unknown request task kind.
const badRequest: Tasks = {tasks:[{kind:'fly'}]};
// @ts-expect-error Unknown request field.
const badRequestField: Tasks = {tasks:[{kind:'hold'}], nw:true};
// @ts-expect-error Unknown nested field.
const badPosition: Task = {...task, destination:{latitdue:1,longitude:2}};
// @ts-expect-error A takeoff requires its target altitude.
const missingAltitude: Tasks = {tasks:[{kind:'takeoff'}]};
`);
    await run(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
      '--noEmit', '--strict', '--module', 'nodenext', consumer]);
    await run(process.execPath, [consumer]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
