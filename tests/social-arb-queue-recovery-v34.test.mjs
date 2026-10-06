import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const maintenance=fs.readFileSync(new URL('../app/api/agent/scroll-jobs/maintenance/route.ts',import.meta.url),'utf8');
const jobs=fs.readFileSync(new URL('../app/api/agent/scroll-jobs/route.ts',import.meta.url),'utf8');
const scheduler=fs.readFileSync(new URL('../scripts/social-arb-scheduler.mjs',import.meta.url),'utf8');

test('queue maintenance gives Social Arb a shorter stale-job TTL than external work',()=>{
 assert.match(maintenance,/SOCIAL_ARB_QUEUE_TTL_MS=30\*60\*1000/);
 assert.match(maintenance,/EXTERNAL_QUEUE_TTL_MS=6\*60\*60\*1000/);
 assert.match(maintenance,/SOCIAL_ARB_ACTIVE_TTL_MS=45\*60\*1000/);
 assert.match(maintenance,/EXTERNAL_ACTIVE_TTL_MS=8\*60\*60\*1000/);
});

test('maintenance only expires active queue states and preserves completed history',()=>{
 assert.match(maintenance,/status IN \('QUEUED','CLAIMED','SCROLLING','ANALYZING','UPLOADING'\)/);
 assert.doesNotMatch(maintenance,/status IN \('COMPLETED','FAILED'/);
 assert.match(maintenance,/QUEUE_TTL_EXPIRED/);
});

test('leased work must be stale before active jobs can expire',()=>{
 assert.match(maintenance,/leaseExpired&&now-activity>ttl/);
 assert.match(maintenance,/heartbeat\|\|row\.started\|\|row\.created/);
});

test('scheduler performs maintenance before evaluating backpressure',()=>{
 const maintenanceAt=scheduler.indexOf('/api/agent/scroll-jobs/maintenance');
 const activeAt=scheduler.indexOf("json('/api/agent/scroll-jobs')");
 assert.ok(maintenanceAt>=0);
 assert.ok(activeAt>maintenanceAt);
});

test('active-job status exposes caller and age for diagnostics',()=>{
 assert.match(jobs,/SELECT id,caller,status,phase/);
 assert.match(jobs,/ageMs/);
});
