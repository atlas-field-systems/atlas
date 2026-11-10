import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createCore } from '../core/core.ts';

export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-spike-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-days', '1'], {stdio:'ignore'});
  const tls = {key:readFileSync(join(directory, 'key.pem')),cert:readFileSync(join(directory, 'cert.pem'))};
  let clock = 1800000000000;
  const config = {database:join(directory,'core.sqlite'),tls,firstAdmin:{operator_id:'ADM',password:'spike-test-password'},now:()=>clock,offlineAfterMs:1000,clockAheadMs:5000};
  let core = await createCore(config);
  let base = await core.listen();
  let cookie = '';
  async function request(method:string,path:string,body?:unknown, options:{key?:string,idempotency?:string,hash?:string,cookie?:string}={}) {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise<{status:number,body:any,headers:https.IncomingHttpHeaders}>((resolve,reject)=>{
      const req = https.request(base+path,{method,ca:tls.cert,headers:{'Atlas-Definitions':options.hash??core.definitionsHash,...(method==='GET'?{}:{'Idempotency-Key':options.idempotency??randomUUID(),'Content-Type':'application/json'}),...(options.key?{Authorization:`Bearer ${options.key}`}:{Cookie:options.cookie??cookie})}},res=>{
        let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode??0,body:data?JSON.parse(data):null,headers:res.headers}));
      });req.on('error',reject);req.end(raw);
    });
  }
  const login = await request('POST','/administration/login',config.firstAdmin);
  cookie = login.headers['set-cookie']?.[0]?.split(';')[0]??'';
  async function provision(asset_id:string) {
    const response=await request('POST','/administration/assets',{asset_id,entity_type:'quadcopter'});
    if(response.status>=300) throw new Error(JSON.stringify(response));
    const key=response.body.key;
    const described=await request('PUT',`/entities/assets/${asset_id}/description`,{time:clock,asset_id,commands:['return_to_home','takeoff','move_to','land'],reports:['status','settings','battery','telemetry']},{key});
    if(described.status>=300) throw new Error(JSON.stringify(described));
    return key;
  }
  return {request,provision,get core(){return core},get base(){return base},tls,get cookie(){return cookie},get time(){return clock},advance(ms:number){clock+=ms;core.sweep()},async restart(){await core.close();core=await createCore(config);base=await core.listen()},async close(){await core.close();rmSync(directory,{recursive:true,force:true})}};
}
