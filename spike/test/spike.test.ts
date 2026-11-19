import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { Client } from '../client.ts';
import { Core } from '../core.ts';
import { Asset } from '../asset.ts';
import { MeshGateway, Radio } from '../gateway.ts';
import { validate, Refusal } from '../protocol.ts';
import type { Rule, Task } from '../protocol.ts';

const policy: Rule[] = [{ rule_id: 'C', priority: 10, conditions: [{ kind: 'battery_below', battery_percent: 10, critical: true }], response: { kind: 'land' } }];
const description = (commands = ['takeoff', 'land', 'return_to_home', 'hold', 'failsafe']) => ({ time: Date.now(), asset_id: 'TEMP', reports: ['status', 'settings'], commands, settings: ['failsafe_policy', 'run_state'] });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-v2-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
async function start(t: TestContext, dir: string, tokens?: string[], crashDuringArchive = false) {
  tokens ??= Array.from({ length: 24 }, () => randomBytes(16).toString('base64url'));
  const credentials = Object.fromEntries(tokens.map((key, i) => [createHash('sha256').update(key).digest('hex'), { role: i === 0 ? 'operator' : i >= 21 ? 'gateway' : 'asset', id: `K${i}` }]));
  const auth = join(dir, 'credentials.json'); writeFileSync(auth, JSON.stringify(credentials));
  const child = spawn(process.execPath, ['server.ts'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SPIKE_DATA: dir, SPIKE_CREDENTIALS: auth, SPIKE_CRASH_DURING_ARCHIVE: crashDuringArchive ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stderr.on('data', c => errors += c);
  const port = await new Promise<number>((resolve, reject) => { child.stdout.on('data', c => { output += c; if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]).port); }); child.once('exit', () => reject(new Error(errors))); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } });
  return { child, tokens, clients: tokens.map(key => new Client(`http://127.0.0.1:${port}`, key)), base: `http://127.0.0.1:${port}` };
}
async function register(client: Client, commands?: string[]) {
  const reply = await client.request('POST', '/entities/assets', description(commands)); assert.equal(reply.status, 201); const id = reply.body.asset_id;
  assert.equal((await client.request('POST', `/entities/assets/${id}/reports`, { reports: [{ type: 'report.settings', asset_id: id, time: Date.now(), settings: { failsafe_policy: policy } }] })).status, 200); return id;
}
const task = (id: number, extra = {}): Task => ({ time: Date.now(), asset_id: '1', task_id: id, send_last: id, clear_count: 0, requested_by: 'OP1', kind: 'hold', ...extra });

test('doc conflict: registration description needs an ID before Core assigns it', () => {
  const { asset_id, ...body } = description();
  assert.throws(() => validate('records/description.json', body), /asset_id/);
});
test('doc conflict: all six commands cannot fit description maxItems=5', () => {
  assert.throws(() => validate('records/description.json', description(['takeoff','move_to','land','return_to_home','hold','failsafe'])), /maxItems/);
});
test('20 concurrent Assets, one ID per key, isolated streams and exactly 64 ordinary admissions', async t => {
  const s = await start(t, fixture(t)); const op = s.clients[0];
  const ids = await Promise.all(s.clients.slice(1,21).map(c => register(c)));
  assert.equal(new Set(ids).size, 20);
  const rejoin = await Promise.all(s.clients.slice(1,21).map(c => c.request('POST', '/entities/assets', description())));
  assert.deepEqual(rejoin.map(r => r.body.asset_id), ids);
  const replies = await Promise.all(Array.from({length: 100}, () => op.tasks(ids[0], [{kind:'hold'}])));
  assert.equal(replies.filter(r => r.status === 202).length, 64);
  assert.equal(replies.filter(r => r.body.error === 'queue_full').length, 36);
  for (let i=0;i<2;i++) assert.equal((await op.tasks(ids[0], [{kind:'hold'}], true)).status, 202);
  assert.equal((await op.tasks(ids[0], [{kind:'hold'}])).status, 409);
  const abort = new AbortController(); t.after(() => abort.abort());
  const own = s.clients[1].events(0, abort.signal);
  const event = (await own.next()).value; assert.equal(event.asset_id, ids[0]); await own.return(undefined);
  assert.equal((await s.clients[1].request('GET', `/tasks/${ids[1]}`)).status, 403);
});
test('concurrent retry, body conflict, malformed JSON, missing hash, unauthorized', async t => {
  const s = await start(t, fixture(t)); const id = await register(s.clients[1]);
  const replies = await Promise.all(Array.from({length:20}, () => s.clients[0].tasks(id,[{kind:'hold'}],false,'retry')));
  assert.equal(new Set(replies.map(r => r.body.event_id)).size, 1);
  assert.equal((await s.clients[0].tasks(id,[{kind:'land'}],false,'retry')).status,409);
  assert.equal((await s.clients[0].request('GET',`/tasks/${id}`)).body.items.length,1);
  assert.equal((await fetch(s.base+'/tasks/'+id,{method:'POST',headers:{Authorization:`Bearer ${s.tokens[0]}`},body:'{'})).status,409);
  assert.equal((await fetch(s.base+'/tasks/'+id)).status,401);
  const response = await fetch(s.base+'/tasks/'+id,{method:'POST',headers:{Authorization:`Bearer ${s.tokens[0]}`,'Atlas-Definitions':(await s.clients[0].request('GET','/about')).body.definitions_hash},body:'{'});
  assert.equal(response.status,400);
});
test('critical policy admission, invalid Fail-safe form, accepted versus reported outcome', async t => {
  const s = await start(t,fixture(t)); const op=s.clients[0], a=s.clients[1];
  const id=(await a.request('POST','/entities/assets',description())).body.asset_id;
  assert.equal((await op.tasks(id,[{kind:'hold'}])).body.error,'no_critical_battery_rule');
  await register(a);
  assert.equal((await op.request('PATCH',`/entities/assets/${id}/settings`,{settings:{failsafe_policy:[]}})).status,409);
  assert.equal((await op.tasks(id,[{kind:'failsafe'}])).status,400);
  const sent=await op.tasks(id,[{kind:'failsafe'}],true); assert.equal(sent.status,202);
  assert.equal((await op.request('GET',`/tasks/${id}`)).body.items[0].state,'queued');
  const report={type:'report.status',kind:'task',asset_id:id,time:Date.now(),task_id:1,task_state:'completed'};
  await a.request('POST',`/entities/assets/${id}/reports`,{reports:[report]});
  await a.request('POST',`/entities/assets/${id}/reports`,{reports:[{...report,task_state:'active'}]});
  assert.equal((await op.request('GET',`/tasks/${id}`)).body.items[0].state,'completed');
});
test('SIGKILL resumes run, identity, numbering and retry; SIGTERM exports checked ZIP and clears', async t => {
  const dir=fixture(t); let s=await start(t,dir); const id=await register(s.clients[1]);
  const about=(await s.clients[0].request('GET','/about')).body;
  const sent=await s.clients[0].tasks(id,[{kind:'hold'}],false,'durable');
  s.child.kill('SIGKILL'); await once(s.child,'exit');
  s=await start(t,dir,s.tokens);
  assert.equal((await s.clients[0].request('GET','/about')).body.run_id,about.run_id);
  assert.equal(await register(s.clients[1]),id);
  assert.deepEqual((await s.clients[0].tasks(id,[{kind:'hold'}],false,'durable')).body,sent.body);
  assert.deepEqual((await s.clients[0].tasks(id,[{kind:'hold'}])).body.task_ids,[2]);
  assert.equal(readdirSync(dir).filter(n=>n.endsWith('.zip')).length,0);
  const obj=await s.clients[0].request('POST','/objects?name=evidence',Buffer.from('retained evidence'));
  const oid=obj.body.object_id; await s.clients[0].request('DELETE',`/objects/${oid}`);
  assert.equal((await s.clients[0].request('GET','/objects')).body.items.length,0);
  for(const path of [`/objects/${oid}`,`/objects/${oid}/file`]) assert.equal((await s.clients[0].request('GET',path)).status,404);
  s.child.kill('SIGTERM'); assert.equal((await once(s.child,'exit'))[0],0);
  const zip=unzipSync(readFileSync(join(dir,`core-run-${about.run_id}.zip`)));
  assert.equal(strFromU8(zip[`objects/${oid}`]),'retained evidence');
  assert.equal(JSON.parse(strFromU8(zip['state/objects.jsonl'])).deleted,true);
  assert.match(strFromU8(zip['events.jsonl']),/spike.recovery/);
  const manifest=JSON.parse(strFromU8(zip['manifest.json']));
  for(const [name,meta] of Object.entries<{size:number;sha256:string}>(manifest)) { assert.equal(zip[name].length,meta.size); assert.equal(createHash('sha256').update(zip[name]).digest('hex'),meta.sha256); }
  for(const token of s.tokens) for(const data of Object.values(zip)) assert.ok(!strFromU8(data).includes(token));
  s=await start(t,dir,s.tokens);
  assert.notEqual((await s.clients[0].request('GET','/about')).body.run_id,about.run_id);
  assert.equal((await s.clients[0].request('GET','/objects')).body.items.length,0);
  // Asset IDs are fresh across runs; Task numbering restarts.
  const newId=await register(s.clients[1]); assert.notEqual(newId,id); assert.deepEqual((await s.clients[0].tasks(newId,[{kind:'hold'}])).body.task_ids,[1]);
});
test('archive write failure holds old run; later start retries it without serving it', t => {
  const dir=fixture(t); let core=new Core(dir); const run=core.run;
  mkdirSync(join(dir,`core-run-${run}.zip.tmp`));
  assert.throws(()=>core.stop()); core.close();
  core=new Core(dir); assert.notEqual(core.run,run); assert.equal(core.events().length,0); core.close();
  rmSync(join(dir,`core-run-${run}.zip.tmp`),{recursive:true});
  core=new Core(dir); assert.ok(readdirSync(dir).includes(`core-run-${run}.zip`)); core.close();
});
test('place snapshot, edit asks false/true, active update, delete preserves copy', async t => {
  const s=await start(t,fixture(t)); const op=s.clients[0], a=s.clients[1];
  const id=await register(a,['takeoff','move_to','land','return_to_home','hold']);
  const point=(latitude:number)=>({kind:'point',position:{latitude,longitude:2}});
  const place=(await op.request('POST','/entities/geofeatures',point(1))).body.geofeature.geofeature_id;
  assert.equal((await op.tasks(id,[{kind:'move_to',geofeature_id:place}])).status,202);
  await op.editPlace(place,point(3),false);
  let taskBody=(await op.request('GET',`/tasks/${id}`)).body.items[0].body; assert.equal(taskBody.destination.latitude,1);
  const asset=new Asset(policy); asset.receive(taskBody);
  await op.editPlace(place,point(4),true);
  taskBody=(await op.request('GET',`/tasks/${id}`)).body.items[0].body; asset.receive(taskBody);
  assert.equal(asset.active?.destination?.latitude,4);
  await op.request('DELETE',`/entities/geofeatures/${place}`);
  assert.equal((await op.request('GET',`/tasks/${id}`)).body.items[0].body.destination.latitude,4);
});
test('100 MB exact boundary and atomic oversize refusal; 1000-item history pages', t => {
  const core=new Core(fixture(t)); t.after(()=>core.close()); const op={role:'operator',id:'OP1'} as const;
  assert.equal(core.maxObjectBytes,100_000_000);
  assert.equal(core.request(op,'POST','/objects?name=boundary',Buffer.alloc(100_000_000),'large')[0],201);
  assert.throws(()=>core.request(op,'POST','/objects?name=oversize',Buffer.alloc(100_000_001),'over'),(e:Refusal)=>e.status===413);
  assert.equal(core.rows('objects').length,1);
  core.tx(()=>{for(let i=0;i<1005;i++)core.event('report.status',{time:i});});
  const first=core.request(op,'GET','/history?limit=2000',{})[1] as { items: unknown[]; next_cursor: number };
  assert.equal(first.items.length,1000);
  const second=core.request(op,'GET',`/history?cursor=${first.next_cursor}`,{})[1] as { items: unknown[]; next_cursor: number }; assert.equal(second.items.length,5);
});
test('mesh relays through another Asset, reconnect, hash refusal, spoof/replay, gateway replacement', async t => {
  const s=await start(t,fixture(t)); const mesh=new MeshGateway(s.clients[21]); const a=new Radio('a'),b=new Radio('b');
  mesh.connect('gateway','a'); mesh.connect('a','b');
  const x=await mesh.join(a), y=await mesh.join(b); assert.notEqual(x,y); assert.equal(await mesh.join(b),y);
  const f=b.frame(y,{reports:[]}); assert.equal(mesh.accept(f).asset_id,y); assert.throws(()=>mesh.accept(f),/replay/);
  assert.throws(()=>mesh.accept(a.frame(y,{})),/spoof/);
  assert.throws(()=>mesh.accept({...b.frame(y,{}),identity:'a'}),/unauthenticated/);
  const c=new Radio('c'); mesh.connect('b','c'); await assert.rejects(()=>mesh.join(c,'bad'),/409/);
  const replacement=new MeshGateway(s.clients[22]); replacement.connect('gateway','b'); const newId=await replacement.join(b); assert.notEqual(newId,y);
  assert.equal((await s.clients[22].request('GET',`/tasks/${y}`)).status,403);
});

test('20-Asset fleet executes Tasks from SSE and reports observed final states over HTTP', async t => {
  const s=await start(t,fixture(t)); const ids=await Promise.all(s.clients.slice(1,21).map(c=>register(c)));
  const cursor=(await s.clients[0].request('GET',`/tasks/${ids[0]}`)).body.as_of;
  await Promise.all(ids.map(id=>s.clients[0].tasks(id,[{kind:'hold'},{kind:'land'}])));
  await Promise.all(ids.map(async(id,index)=>{
    const client=s.clients[index+1], asset=new Asset(policy); const abort=new AbortController();
    try {
      for await(const event of client.events(cursor,abort.signal)) {
        if(event.kind!=='tasks.requested')continue;
        // Deliberately reverse delivery and duplicate it, as a field link can.
        for(const body of [...event.record].reverse()) { asset.receive(body); asset.receive(body); }
        assert.equal(asset.active?.task_id,1); asset.observeCompletion(); asset.observeCompletion();
        const reports=asset.reports.map(r=>({type:'report.status',kind:'task',asset_id:id,time:Date.now(),...r}));
        assert.equal((await client.request('POST',`/entities/assets/${id}/reports`,{reports})).status,200);
        break;
      }
    } finally { abort.abort(); }
    const rows=(await s.clients[0].request('GET',`/tasks/${id}`)).body.items;
    assert.deepEqual(rows.map((r:{state:string})=>r.state),['completed','completed']);
    assert.deepEqual(asset.fc.attempts,['hold','land']);
  }));
});
test('offline Assets refuse every command including Fail-safe without queueing', t => {
  const core=new Core(fixture(t));t.after(()=>core.close());const caller={role:'asset',id:'K1'} as const;
  const id=(core.request(caller,'POST','/entities/assets',description(),'register')[1] as {asset_id:string}).asset_id;
  const row=core.get('assets',id);row.heard=Date.now()-61_000;row.settings={failsafe_policy:policy};core.put('assets',id,row);
  for(const kind of ['land','return_to_home','hold','failsafe'])assert.throws(()=>core.request({role:'operator',id:'OP1'},'POST',`/tasks/${id}`,{tasks:[{kind}],now:true},kind),(e:Refusal)=>e.code==='offline');
  assert.equal(core.rows('tasks').length,0);
});
test('queue waits for missing batch, executes once, failure clears and rejects stale work',()=>{
  const a=new Asset(policy);a.receive(task(2,{send_last:2}));assert.equal(a.active,null);
  a.receive(task(1,{send_last:2}));assert.equal(a.states.get(1),'active');
  a.observeCompletion(false);assert.equal(a.states.get(2),'cancelled');assert.equal(a.clear_count,1);
  a.receive(task(2));a.receive(task(3));assert.equal(a.states.get(3),'cancelled');assert.equal(a.fc.attempts.length,1);
  a.receive(task(4,{now:true,kind:'land'}));assert.equal(a.states.get(4),'active');
});
test('Fail-safe command selects operator rule with other conditions, otherwise maker safe action',()=>{
  const rule:Rule={rule_id:'CMD',priority:50,conditions:[{kind:'commanded'},{kind:'airborne'}],response:{kind:'return_to_home'}};
  const a=new Asset([...policy,rule]);a.fc.armed=true;a.receive(task(1,{kind:'failsafe',now:true}));
  assert.equal(a.failsafe,true);assert.equal(a.response?.kind,'return_to_home');assert.equal(a.states.get(1),'completed');
  const b=new Asset([rule]);b.receive(task(1,{kind:'failsafe',now:true}));assert.equal(b.response?.kind,'land');
  a.receive(task(2,{kind:'failsafe',now:true}));assert.equal(a.states.get(2),'failed');
  a.receive(task(3,{kind:'takeoff'}));assert.equal(a.states.get(3),'failed');
});
for(const override of ['hold','pause'])for(const trigger of ['contact_lost','battery_below'])test(`${override} re-arms ${trigger} only after false then true`,()=>{
  const rule:Rule={rule_id:'LOW',priority:40,conditions:[trigger==='contact_lost'?{kind:trigger}:{kind:trigger,battery_percent:30}],response:{kind:'return_to_home'}};
  const a=new Asset([...policy,rule]);a.contact=false;a.battery=20;a.evaluate();assert.equal(a.failsafe,true);
  const count=a.fc.attempts.length;
  if(override==='hold')a.receive(task(1,{now:true}));else a.pause();
  a.evaluate();assert.equal(a.fc.attempts.length,count+(override==='hold'?1:0));
  a.contact=true;a.battery=80;a.evaluate();a.contact=false;a.battery=20;a.evaluate();
  assert.equal(a.response?.kind,'return_to_home');assert.equal(a.override,null);assert.equal(a.failsafe,true);
});
for(const override of ['hold','pause'])test(`critical battery always fires immediately through ${override}, even at lower priority`,()=>{
  const a=new Asset([...policy,{rule_id:'HIGH',priority:90,conditions:[{kind:'contact_lost'}],response:{kind:'return_to_home'}}]);
  a.contact=false;a.evaluate();a.battery=5;
  if(override==='hold')a.receive(task(1,{now:true}));else a.pause();
  assert.equal(a.response?.kind,'land');assert.equal(a.override,null);assert.equal(a.paused,false);
  const n=a.fc.attempts.length;
  if(override==='hold')a.receive(task(2,{now:true}));else a.pause();
  assert.ok(a.fc.attempts.length>n);assert.equal(a.response?.kind,'land');
});
for(const kind of ['land','return_to_home'])test(`${kind} override stands at critical battery`,()=>{
  const a=new Asset(policy);a.battery=5;a.evaluate();a.receive(task(1,{kind,now:true}));a.evaluate();assert.equal(a.fc.mode,kind);assert.equal(a.override,kind);
});
test('crashed app stays down; independent heartbeat-loss return home; ground restart drops work',()=>{
  const a=new Asset(policy);a.receive(task(1,{kind:'takeoff'}));a.receive(task(2));a.tick(1000);a.crash();
  a.tick(7000);assert.equal(a.alive,false);assert.equal(a.fc.mode,'return_to_home');
  assert.throws(()=>a.restartOnGround(),/inspect/);assert.equal(a.states.get(1),'active'); // Missing report is no outcome.
  a.fc.armed=false;a.restartOnGround();assert.equal(a.states.get(2),'cancelled');assert.equal(a.active,null);
  a.receive(task(2));assert.equal(a.active,null);
});
test('Plugin result lists accept 1000, reject 1001 without truncation (validator probe)',()=>{
  const result={type:'plugin.result',time:Date.now(),plugin_id:'P1',request_id:1,facts:Array.from({length:1000},()=>({label:'Count',text:'1'}))};
  const input={...result};
  assert.doesNotThrow(()=>validate('records/plugin/result.json',input));
  assert.throws(()=>validate('records/plugin/result.json',{...input,facts:[...input.facts,{label:'Count',text:'1'}]}),/maxItems/);
});
test('critical battery overrides a higher-priority Atlas response without operator intervention',()=>{
  const a=new Asset([...policy,{rule_id:'HIGH',priority:90,conditions:[{kind:'contact_lost'}],response:{kind:'hold'}}]);
  a.contact=false;a.evaluate();assert.equal(a.response?.kind,'hold');a.battery=5;a.evaluate();assert.equal(a.response?.kind,'land');
});
test('SIGKILL during ZIP writing finishes deliberate stop on restart',async t=>{
  const dir=fixture(t);let s=await start(t,dir,undefined,true);const run=(await s.clients[0].request('GET','/about')).body.run_id;
  await register(s.clients[1]);s.child.kill('SIGTERM');assert.equal((await once(s.child,'exit'))[1],'SIGKILL');
  assert.ok(readdirSync(dir).includes(`core-run-${run}.zip.tmp`));
  s=await start(t,dir,s.tokens);assert.notEqual((await s.clients[0].request('GET','/about')).body.run_id,run);
  assert.ok(readdirSync(dir).includes(`core-run-${run}.zip`));
});
test('manual ground restart rejoins by key and reports its queued Tasks cancelled',async t=>{
  const s=await start(t,fixture(t));const op=s.clients[0],client=s.clients[1];const id=await register(client);
  const asset=new Asset(policy);asset.paused=true;
  await op.tasks(id,[{kind:'hold'},{kind:'land'}]);
  const tasks=(await op.request('GET',`/tasks/${id}`)).body.items;
  for(const task of tasks)asset.receive(task.body);
  asset.crash();asset.restartOnGround();assert.equal(await register(client),id);
  const reports=asset.reports.map(r=>({type:'report.status',kind:'task',time:Date.now(),asset_id:id,...r}));
  assert.equal((await client.request('POST',`/entities/assets/${id}/reports`,{reports})).status,200);
  assert.deepEqual((await op.request('GET',`/tasks/${id}`)).body.items.map((r:{state:string})=>r.state),['cancelled','cancelled']);
  assert.equal(asset.fc.attempts.length,0);
});
