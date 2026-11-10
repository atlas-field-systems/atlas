import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { fixture } from './harness.ts';

// Oracle: core/docs/api.md — Basics; Operator requests; Contact.
test('concurrent fleet requests are atomic, numbered once, and isolated', async t=>{
 const f=await fixture();t.after(()=>f.close());
 const ids=Array.from({length:24},(_,i)=>`A${i}`);
 const keys=await Promise.all(ids.map(id=>f.provision(id)));
 const responses=await Promise.all(ids.flatMap(id=>Array.from({length:12},(_,i)=>f.request('POST',`/tasks/${id}`,{tasks:[{kind:'return_to_home'}]},{idempotency:`${id}-${i}`}))));
 for(const response of responses) assert.equal(response.status,202,JSON.stringify(response.body));
 for(const id of ids){
  const numbers=responses.filter((_,i)=>ids[Math.floor(i/12)]===id).flatMap(r=>r.body.task_ids).sort((a,b)=>a-b);
  assert.deepEqual(numbers,Array.from({length:12},(_,i)=>i+1));
 }
 const retries=await Promise.all(Array.from({length:30},()=>f.request('POST','/tasks/A0',{tasks:[{kind:'return_to_home'}]},{idempotency:'retry-burst'})));
 assert.equal(new Set(retries.map(r=>JSON.stringify(r.body))).size,1);
 assert.equal(retries[0].status,202);
 assert.equal((await f.request('POST','/tasks/A0',{tasks:[{kind:'land'}]},{idempotency:'retry-burst'})).status,409);
 assert.equal((await f.request('GET','/tasks/A1',undefined,{key:keys[0]})).status,403);
 assert.equal((await f.request('GET','/tasks/A0',undefined,{key:'wrong-key'})).status,401);
 assert.equal((await f.request('GET','/entities/assets',undefined,{hash:'wrong'})).status,409);
 assert.equal((await f.request('GET','/fusion')).status,404);
});

// Oracle: core/docs/storage.md — Every change writes one event; Runs.
test('restart retains state and retry responses without replaying events',async t=>{
 const f=await fixture();t.after(()=>f.close());await f.provision('A1');
 const original=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'},{kind:'return_to_home'}]},{idempotency:'flight'});
 assert.equal(original.status,202);
 const before=await f.request('GET','/tasks/A1');
 await f.restart();
 assert.deepEqual((await f.request('GET','/tasks/A1')).body,before.body);
 const retry=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'},{kind:'return_to_home'}]},{idempotency:'flight'});
 assert.deepEqual(retry.body,original.body);
 assert.deepEqual((await f.request('GET','/tasks/A1')).body,before.body);
});

// Oracle: core/docs/api.md — Asset and gateway calls; Reads.
test('clock-ahead and old reports stay in history without replacing latest settings',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 for(const [offset,lights] of [[0,'on'],[-1,'off'],[6000,'off']] as const){
  const result=await f.request('POST','/entities/assets/A1/reports',{reports:[{type:'report.settings',time:f.time+offset,asset_id:'A1',settings:{lights}}]},{key});
  assert.equal(result.status,200,JSON.stringify(result.body));
 }
 const asset=await f.request('GET','/entities/assets/A1');
 assert.equal(asset.body.settings.lights,'on');
 const history=await f.request('GET','/history?asset_id=A1&report=settings&limit=2');
 assert.equal(history.status,200);
 assert.ok(history.body.next_cursor);
});

// Oracle: core/docs/api.md — Operator requests; Contact.
test('offline rejects new work and drops unanswered tasks, settings, and cancels',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 await f.request('POST','/entities/assets/A1/reports',{reports:[{type:'report.settings',time:f.time,asset_id:'A1',settings:{lights:'off'}}]},{key});
 assert.equal((await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]})).status,202);
 assert.equal((await f.request('PATCH','/entities/assets/A1/settings',{settings:{lights:'on'}})).status,202);
 assert.equal((await f.request('POST','/tasks/A1/1/cancel',{})).status,202);
 f.advance(1001);
 assert.equal((await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]})).status,409);
 const rows=f.core.db.prepare("SELECT kind FROM events WHERE kind IN ('request.dropped','task.dropped')").all();
 assert.equal(rows.filter(r=>r.kind==='request.dropped').length,3);
 assert.equal(rows.filter(r=>r.kind==='task.dropped').length,1);
 assert.equal((await f.request('POST','/entities/assets/A1/reports',{reports:[]},{key})).status,200);
});

// Oracle: core/docs/api.md — The event log and live stream.
test('snapshot then follow and Last-Event-ID deliver each later event',async t=>{
 const f=await fixture();t.after(()=>f.close());await f.provision('A1');
 const snapshot=await f.request('GET','/tasks/A1');
 assert.equal(typeof snapshot.body.as_of,'number');
 const accepted=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 const id=accepted.body.event_id;
 await new Promise<void>((resolve,reject)=>{
  const req=https.get(f.base+`/events?definitions=${f.core.definitionsHash}`,{ca:f.tls.cert,headers:{Cookie:f.cookie,'Last-Event-ID':String(snapshot.body.as_of)}},res=>{
   let data='';res.on('data',chunk=>{data+=chunk;if(data.includes(`id: ${id}\n`)){req.destroy();resolve()}});
  });req.on('error',reject);req.setTimeout(3000,()=>{req.destroy();reject(new Error('SSE resume timed out'))});
 });
});

// Oracle: asset/docs/README.md — Start and connect; The queue; Handle failures and link loss.
test('Asset double executes through HTTPS and SSE, keeps work across Core restart',async t=>{
 const {createAsset}=await import('../asset/asset.ts');
 const {SpikeClient}=await import('../client/client.ts');
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 let client=new SpikeClient({baseUrl:f.base,definitionsHash:f.core.definitionsHash,ca:f.tls.cert,key});
 const asset=await createAsset({asset_id:'A1',now:()=>f.time,settings:{home_position:{latitude:40,longitude:-70}}});
 await asset.reconnect(client);
 const accepted=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'},{kind:'return_to_home'}]});
 assert.equal(accepted.status,202);
 const stream=client.events({after:asset.lastEvent});
 try {
  for await(const value of stream){
   if(!value || typeof value!=='object' || !('event_id' in value)||!('kind'in value)||!('record'in value)||typeof value.event_id!=='number'||typeof value.kind!=='string') throw new Error('invalid event');
   asset.receive({event_id:value.event_id,kind:value.kind,record:value.record});
   if(value.event_id===accepted.body.event_id)break;
  }
 }finally{await stream.return()}
 assert.equal(asset.active,1);assert.deepEqual(asset.queue(),[2]);
 await asset.flush(client);
 await f.restart();
 client=new SpikeClient({baseUrl:f.base,definitionsHash:f.core.definitionsHash,ca:f.tls.cert,key});
 await asset.reconnect(client);
 assert.equal(asset.active,1);
 asset.complete();assert.equal(asset.active,2);asset.complete();await asset.flush(client);
 const result=await f.request('GET','/tasks/A1');
 assert.equal(result.status,200);
 assert.ok(JSON.stringify(result.body).includes('completed'));
 assert.deepEqual(asset.executions.filter(e=>typeof e.id==='number').map(e=>e.id),[1,2]);
});

// Oracle: core/docs/api.md — Basics; Asset and gateway calls. A batch is accepted whole.
test('malformed batch rolls back; cross-Asset reports fail; terminal outcomes cannot regress',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');await f.provision('A2');
 const accepted=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});assert.equal(accepted.status,202);
 const eventCount=()=>Number(f.core.db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n);
 const count=eventCount();
 const valid={type:'report.status',time:f.time,asset_id:'A1',kind:'task',task_id:1,task_state:'completed'};
 const bad=await f.request('POST','/entities/assets/A1/reports',{reports:[valid,{...valid,task_id:2,task_state:'active'}]},{key});
 assert.equal(bad.status,409);assert.equal(eventCount(),count);
 assert.equal((await f.request('POST','/entities/assets/A2/reports',{reports:[]},{key})).status,403);
 assert.equal((await f.request('POST','/entities/assets/A1/reports',{reports:[valid]},{key})).status,200);
 assert.equal((await f.request('POST','/entities/assets/A1/reports',{reports:[{...valid,task_state:'active'}]},{key})).status,200);
 const state=await f.request('GET','/tasks/A1');assert.equal(state.body.tasks[0].task_state,'completed');
 assert.throws(()=>f.core.db.prepare('DELETE FROM events').run(),/append only/);
 assert.throws(()=>f.core.db.prepare("UPDATE events SET kind='changed'").run(),/append only/);
});

// Oracle: core/docs/api.md — Compatibility; Accounts and provisioning.
test('definitions refusals, cookie flags, roles, gateway scope, and key rotation',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');await f.provision('A2');
 const login=await f.request('POST','/administration/login',{operator_id:'ADM',password:'spike-test-password'});
 const cookie=login.headers['set-cookie']?.[0]??'';
 for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(cookie.includes(flag));
 assert.equal((await f.request('GET','/about',undefined,{key,hash:'bad'})).status,409);
 assert.equal(f.core.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='definitions.refused'").get()?.n,1);
 const gateway=await f.request('POST','/administration/gateways',{gateway_id:'G1',asset_ids:['A1']});
 assert.equal(gateway.status,201);assert.equal(gateway.body.provisional,true);
 assert.equal((await f.request('GET','/tasks/A1',undefined,{key:gateway.body.key})).status,200);
 assert.equal((await f.request('GET','/tasks/A2',undefined,{key:gateway.body.key})).status,403);
 await f.request('POST','/administration/accounts',{operator_id:'OP1',password:'operator-test-password',role:'operator'});
 const op=await f.request('POST','/administration/login',{operator_id:'OP1',password:'operator-test-password'});
 const opCookie=op.headers['set-cookie']?.[0]?.split(';')[0];
 assert.equal((await f.request('POST','/administration/assets',{asset_id:'NO'},{cookie:opCookie})).status,403);
 const replaced=await f.request('POST','/administration/assets/A1/key',{});assert.equal(replaced.status,200);
 assert.equal(replaced.body.key.length,22);
 assert.equal((await f.request('GET','/tasks/A1',undefined,{key})).status,401);
 assert.equal((await f.request('GET','/tasks/A1',undefined,{key:replaced.body.key})).status,200);
});

// Oracle: core/docs/api.md — Unanswered requests end when the Asset goes offline.
test('held Tasks survive contact loss; returning complete queue repairs dropped gaps',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 const first=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 await f.request('POST','/entities/assets/A1/reports',{reports:[{type:'report.status',time:f.time,asset_id:'A1',kind:'queue',task_ids:[1],clear_count:0,request_id:first.body.event_id}]},{key});
 const lost=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 f.advance(1001);
 assert.equal(f.core.db.prepare('SELECT dropped FROM requests WHERE event_id=?').get(first.body.event_id)?.dropped,0);
 assert.equal(f.core.db.prepare('SELECT dropped FROM requests WHERE event_id=?').get(lost.body.event_id)?.dropped,1);
 const returned=await f.request('POST','/entities/assets/A1/reports',{reports:[{type:'report.status',time:f.time,asset_id:'A1',kind:'queue',task_ids:[1],clear_count:0}]},{key});
 assert.equal(returned.status,200);
 const repair=f.core.db.prepare("SELECT record FROM events WHERE kind='cancel.requested' ORDER BY event_id DESC LIMIT 1").get();
 assert.equal(JSON.parse(String(repair?.record)).task_id,2);
});

// Oracle: atlas/scale.md — Fleet; core/docs/api.md — Operator requests; asset/docs/README.md — The queue.
test('twenty live Asset doubles receive whole missions, retry reports, and complete independently',async t=>{
 const {createAsset}=await import('../asset/asset.ts');const {SpikeClient}=await import('../client/client.ts');
 const f=await fixture();t.after(()=>f.close());
 const fleet=await Promise.all(Array.from({length:20},async(_,i)=>{
  const id=`M${i}`,key=await f.provision(id);
  const client=new SpikeClient({baseUrl:f.base,definitionsHash:f.core.definitionsHash,ca:f.tls.cert,key});
  const asset=await createAsset({asset_id:id,now:()=>f.time,settings:{home_position:{latitude:40,longitude:-70}}});
  await asset.reconnect(client);return {id,client,asset};
 }));
 await Promise.all(fleet.map(async({id,client,asset})=>{
  const accepted=await f.request('POST',`/tasks/${id}`,{tasks:Array.from({length:4},()=>({kind:'return_to_home'}))});
  assert.equal(accepted.status,202);
  for await(const value of client.events({after:asset.lastEvent})){
   if(!value || typeof value!=='object'||!('event_id'in value)||!('kind'in value)||!('record'in value)||typeof value.event_id!=='number'||typeof value.kind!=='string')throw new Error('Invalid envelope');
   asset.receive({event_id:value.event_id,kind:value.kind,record:value.record});
   if(value.event_id===accepted.body.event_id)break;
  }
  assert.equal(asset.active,1);assert.deepEqual(asset.queue(),[2,3,4]);
  const batch=asset.takeBatch();
  const replies=await Promise.all(Array.from({length:3},()=>client.request('POST',`/entities/assets/${id}/reports`,{reports:batch.reports},batch.key)));
  assert.deepEqual(replies[0].body,replies[2].body);asset.ackBatch(batch.key);
  for(let i=0;i<4;i++)asset.complete();await asset.flush(client);
  assert.deepEqual(asset.executions.map(e=>e.id),[1,2,3,4]);
  const snapshot=await f.request('GET',`/tasks/${id}`);
  assert.deepEqual(snapshot.body.tasks.map(task=>task.task_state),['completed','completed','completed','completed']);
 }));
});

// Oracle: core/docs/api.md — Contact; Unanswered requests end when the Asset goes offline.
test('an open SSE stream does not keep Core contact alive and resumed streams skip dropped requests',async t=>{
 const {SpikeClient}=await import('../client/client.ts');const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 const client=new SpikeClient({baseUrl:f.base,definitionsHash:f.core.definitionsHash,ca:f.tls.cert,key});
 const start=(await f.request('GET','/tasks/A1')).body.as_of;
 const lost=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 const open=await new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{
  const req=https.get(f.base+`/events?definitions=${f.core.definitionsHash}&after=${start}`,{ca:f.tls.cert,headers:{Authorization:`Bearer ${key}`}},resolve);req.on('error',reject);
 });
 t.after(()=>open.destroy());f.advance(1001);
 const state=await f.request('GET','/entities/assets/A1');assert.equal(state.body.contact,'offline');open.destroy();
 await client.request('POST','/entities/assets/A1/reports',{reports:[]});
 const fresh=await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 const seen:number[]=[];
 for await(const value of client.events({after:start,signal:AbortSignal.timeout(3000)})){
  if(value&&typeof value==='object'&&'event_id'in value&&typeof value.event_id==='number'){
   seen.push(value.event_id);if(value.event_id===fresh.body.event_id)break;
  }
 }
 assert.ok(!seen.includes(lost.body.event_id));assert.ok(seen.includes(fresh.body.event_id));
});

// Oracle: core/docs/api.md — Basics, retries return the original response even after circumstances change.
test('offline refusal retries remain refusals after contact returns; new key accepts work',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');f.advance(1001);
 const body={tasks:[{kind:'return_to_home'}]};
 const refused=await f.request('POST','/tasks/A1',body,{idempotency:'refused-work'});assert.equal(refused.status,409);
 await f.request('POST','/entities/assets/A1/reports',{reports:[]},{key});
 const retried=await f.request('POST','/tasks/A1',body,{idempotency:'refused-work'});
 assert.equal(retried.status,409);assert.deepEqual(retried.body,refused.body);
 assert.equal((await f.request('POST','/tasks/A1',body)).status,202);
});

// Oracle: core/docs/api.md — Accepted is not done; asset/docs/README.md — Cancel.
test('cancel acceptance racing with a final report never establishes a cancelled outcome',async t=>{
 const f=await fixture();t.after(()=>f.close());const key=await f.provision('A1');
 await f.request('POST','/tasks/A1',{tasks:[{kind:'return_to_home'}]});
 const report=(task_state:string)=>({reports:[{type:'report.status',time:f.time,asset_id:'A1',kind:'task',task_id:1,task_state}]});
 await f.request('POST','/entities/assets/A1/reports',report('active'),{key});
 const [cancel,completed]=await Promise.all([
  f.request('POST','/tasks/A1/1/cancel',{}),
  f.request('POST','/entities/assets/A1/reports',report('completed'),{key}),
 ]);
 assert.equal(cancel.status,202);assert.equal(completed.status,200);
 const before=await f.request('GET','/tasks/A1');assert.equal(before.body.tasks[0].task_state,'completed');
 await f.request('POST','/entities/assets/A1/reports',{reports:[{...report('completed').reports[0],request_id:cancel.body.event_id}]},{key});
 const after=await f.request('GET','/tasks/A1');assert.equal(after.body.tasks[0].task_state,'completed');
});
