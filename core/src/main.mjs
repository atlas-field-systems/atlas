// Runs Core. Settings come from the environment:
// PORT, ATLAS_DB (file, default memory), ATLAS_ENROLLMENT_KEY, ATLAS_OPERATORS ("OP1:key,OP2:key").
import { startCore, hash } from './core.mjs';

const operators = Object.fromEntries((process.env.ATLAS_OPERATORS ?? '').split(',').filter(Boolean)
  .map((pair) => { const [id, key] = pair.split(':'); return [id, hash(key)]; }));
const core = await startCore({
  port: Number(process.env.PORT ?? 8080),
  db: process.env.ATLAS_DB,
  enrollmentKey: process.env.ATLAS_ENROLLMENT_KEY,
  operators,
  log: console.log,
});
console.log(`Atlas Core on http://localhost:${core.port}`);
