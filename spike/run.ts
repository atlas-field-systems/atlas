import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createCore } from './core/core.ts';

// Local spike launcher; provisioning is through the HTTPS API.
const password = process.env.SPIKE_ADMIN_PASSWORD;
const certificate = process.env.SPIKE_TLS_CERT;
const privateKey = process.env.SPIKE_TLS_KEY;
if (!password || !certificate || !privateKey) {
  throw new Error('Set SPIKE_ADMIN_PASSWORD, SPIKE_TLS_CERT, and SPIKE_TLS_KEY. See spike/README.md.');
}
mkdirSync(new URL('./.runtime/', import.meta.url), {recursive:true});
const core = await createCore({
  database: new URL('./.runtime/core.sqlite', import.meta.url).pathname,
  tls:{cert:readFileSync(certificate),key:readFileSync(privateKey)},
  firstAdmin:{operator_id:'ADM',password},
  diagnostics:entry=>appendFileSync(new URL('./.runtime/core.log',import.meta.url),JSON.stringify(entry)+'\n'),
});
const address = await core.listen(Number(process.env.SPIKE_PORT ?? 8443));
process.stdout.write(JSON.stringify({kind:'spike.listening',address,definitions_hash:core.definitionsHash})+'\n');
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,async()=>{await core.close()});
