import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = await mkdtemp(join(tmpdir(),'atlas-phase3-manual-'));
await writeFile(join(dir,'password'),'manual-check-password');
await writeFile(join(dir,'config.json'),JSON.stringify({data_directory:dir,listen_address:'127.0.0.1',port:0,first_admin:{operator_id:'ADM',password_file:join(dir,'password')}}));
const child = spawn(process.execPath,['core/src/main.ts',join(dir,'config.json')],{stdio:['ignore','pipe','inherit']});
const lines = createInterface({input:child.stdout});
const [line] = await once(lines,'line');
console.log('$ node core/src/main.ts <temporary config>\n'+line);
const {url}=JSON.parse(line);
const about=await (await fetch(url+'/about')).json();
let cookie;
async function call(method,path,body,credential=cookie,binary=false) {
  const headers={'atlas-definitions':about.definitions_hash,'idempotency-key':crypto.randomUUID(),'content-type':binary?'text/plain':'application/json'};
  if (credential?.startsWith('atlas_session=')) headers.cookie=credential;
  else if(credential) headers.authorization='Bearer '+credential;
  const r=await fetch(url+path,{method,headers,...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  const data=await r.json();
  const safe={...data};delete safe.key;
  console.log(`${method} ${path} -> ${r.status} ${JSON.stringify(safe)}`);
  return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try {
  cookie=(await call('POST','/administration/login',{operator_id:'ADM',password:'manual-check-password'})).cookie;
  await call('POST','/administration/accounts',{operator_id:'OP1',password:'manual-operator-password',admin:false});
  const plugin=(await call('POST','/administration/plugins')).data;
  cookie=(await call('POST','/administration/login',{operator_id:'OP1',password:'manual-operator-password'})).cookie;
  const object=(await call('POST','/objects?name=note.txt','phase three\n',cookie,true)).data;
  const place=(await call('POST','/entities/geofeatures',{kind:'point',name:'Test place',position:{latitude:0,longitude:0}})).data;
  await call('PATCH',`/objects/${object.object_id}`,{geofeature_id:place.geofeature.geofeature_id});
  await call('PUT',`/plugins/${plugin.plugin_id}/description`,{type:'plugin.description',time:Date.now(),plugin_id:plugin.plugin_id,name:'Manual lookup',actions:[{action:'lookup',label:'Lookup',inputs:[]}]},plugin.key);
  const invocation=(await call('POST',`/plugins/${plugin.plugin_id}/actions/lookup`,{inputs:[]})).data;
  await call('POST',`/plugins/${plugin.plugin_id}/answers`,{type:'plugin.result',time:Date.now(),plugin_id:plugin.plugin_id,request_id:invocation.event_id},plugin.key);
} finally {
  console.log('$ kill -TERM <Core PID>');
  const exited=once(child,'exit');child.kill('SIGTERM');
  const [code]=await exited;console.log('Core exit '+code);
}
const zip=(await readdir(join(dir,'archive'))).find(n=>n.endsWith('.zip'));
console.log('$ unzip -l '+join(dir,'archive',zip));
console.log(execFileSync('unzip',['-l',join(dir,'archive',zip)],{encoding:'utf8'}));
