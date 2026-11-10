import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { fixture } from '../test/harness.ts';

// core/docs/api.md — Operator requests; identity belongs to authenticated caller.
test('settings attribution cannot be supplied by operator', async t => {
  const f = await fixture(); t.after(() => f.close()); await f.provision('A1');
  assert.equal((await f.request('PATCH', '/entities/assets/A1/settings', {settings:{lights:'on'},requested_by:'FAKE'})).status,400);
  assert.equal((await f.request('PATCH', '/entities/assets/A1/settings', {settings:{lights:'on'},asset_id:'A2'})).status,400);
});

// core/docs/storage.md — Every change writes one event; reports batch atomicity.
test('invalid report batch stores neither report nor partial task state', async t => {
  const f = await fixture(); t.after(() => f.close()); const key = await f.provision('A1');
  const before = Number(f.core.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'report.%'").get()?.n);
  assert.equal((await f.request('POST','/entities/assets/A1/reports',{reports:[
    {type:'report.settings',time:f.time,asset_id:'A1',settings:{lights:'on'}},
    {type:'report.status',time:f.time,asset_id:'A1',kind:'task',task_id:999,task_state:'active'},
  ]},{key})).status,409);
  assert.equal(Number(f.core.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'report.%'").get()?.n),before);
  assert.throws(() => f.core.db.prepare('UPDATE events SET kind=?').run('changed'),/append only/);
});

// core/docs/api.md — The event log and live stream. Force backpressure with
// a deliberately large provisional internal Track event, then recover from disk.
test('slow SSE reader is closed on backpressure and resumes its persisted cursor', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (let i=0;i<8;i++) f.core.entities.putTrack(String(i), {payload:'x'.repeat(256*1024)});
  function collect(after:number) {
    return new Promise<string>((resolve,reject) => {
      const req=https.get(f.base+`/events?definitions=${f.core.definitionsHash}&after=${after}`, {ca:f.tls.cert,headers:{Cookie:f.cookie}}, res=>{
        res.pause(); let data='';
        res.on('data',chunk=>data+=chunk); res.on('end',()=>resolve(data)); res.on('error',reject);
        setTimeout(()=>res.resume(),60);
      }); req.on('error',reject); req.setTimeout(3000,()=>req.destroy(new Error('backpressure stream stayed open')));
    });
  }
  const first=await collect(0);
  const ids=[...first.matchAll(/^id: (\d+)$/gm)].map(match=>Number(match[1]));
  assert.ok(ids.length>0 && ids.length<8);
  const last=ids.at(-1)!;
  const second=await collect(last);
  const next=[...second.matchAll(/^id: (\d+)$/gm)].map(match=>Number(match[1]));
  assert.equal(next[0],last+1);
  assert.equal(Number(f.core.db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n),8);
});

// core/docs/api.md — Accounts and provisioning; Asset and gateway calls;
// explicit stand-in bindings/contact are marked provisional in core/NOTES.md.
test('gateway credentials restrict Assets and provisional contact drops unanswered work', async t => {
  const f = await fixture(); t.after(() => f.close()); await f.provision('A1'); await f.provision('A2');
  const gateway=await f.request('POST','/administration/gateways',{gateway_id:'G1',asset_ids:['A1']});
  assert.equal(gateway.status,201); const key=gateway.body.key;
  assert.equal((await f.request('GET','/tasks/A2',undefined,{key})).status,403);
  assert.equal((await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]})).status,202);
  assert.equal((await f.request('POST','/entities/assets/A1/contact',{online:false,last_heard:f.time},{key})).status,200);
  assert.equal((await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]})).status,409);
  assert.equal(Number(f.core.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='request.dropped'").get()?.n),1);
  assert.equal((await f.request('POST','/entities/assets/A1/contact',{online:true,last_heard:f.time},{key})).status,200);
});

// core/docs/api.md — Basics and Callers and credentials prescribe conflicting
// retention for a response carrying a newly issued bearer key. Characterize the
// stand-in; this passing test does not approve retaining recoverable credentials.
test('design probe: retrying credential issuance retains recoverable key in idempotency response', async t => {
  const f=await fixture();t.after(()=>f.close());
  const body={asset_id:'A1',type:'asset'};
  const first=await f.request('POST','/administration/assets',body,{idempotency:'issue-key'});
  const retry=await f.request('POST','/administration/assets',body,{idempotency:'issue-key'});
  assert.equal(first.status,201);assert.deepEqual(retry.body,first.body);
  const stored=f.core.db.prepare("SELECT response FROM idempotency_keys WHERE caller='account:ADM' AND key='issue-key'").get();
  assert.equal(JSON.parse(String(stored?.response)).key,first.body.key);
  const credential=f.core.db.prepare('SELECT * FROM asset_keys WHERE id=?').get('A1');
  assert.equal(Object.hasOwn(credential!,'key'),false);
  assert.notEqual(credential?.key_hash,first.body.key);
});

// core/docs/api.md — Accounts and provisioning; a replaced bearer key cannot
// keep receiving accepted work through an already authenticated event stream.
test('key rotation closes an already open Asset SSE stream', async t => {
  const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
  let open!:()=>void;const opened=new Promise<void>(resolve=>open=resolve);
  const closed=new Promise<void>((resolve,reject)=>{
    const req=https.get(f.base+`/events?definitions=${f.core.definitionsHash}`,{ca:f.tls.cert,headers:{Authorization:`Bearer ${key}`}},res=>{
      assert.equal(res.statusCode,200);res.resume();res.on('end',resolve);res.on('error',reject);open();
    });req.on('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('revoked stream stayed open')));
  });
  await opened;
  const replaced=await f.request('POST','/administration/assets/A1/key',{});assert.equal(replaced.status,200);
  await closed;
  assert.equal((await f.request('GET','/tasks/A1',undefined,{key})).status,401);
});
