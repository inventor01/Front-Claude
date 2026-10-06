import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const route=fs.readFileSync(new URL('../app/api/social-arb/bridge-status/route.ts',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../app/social-arb-panel.tsx',import.meta.url),'utf8');

test('bridge status is signed-in read-only data and exposes no bridge secret',()=>{
 assert.match(route,/getChatGPTUser/);
 assert.match(route,/Please sign in to view Front bridge status/);
 assert.match(route,/bridge_agents/);
 assert.doesNotMatch(route,/FRONT_BRIDGE_API_KEY/);
 assert.doesNotMatch(route,/x-front-bridge-key/);
});

test('bridge status reports actual recency and queued work',()=>{
 assert.match(route,/now-lastSeen<45_000/);
 assert.match(route,/agent_scroll_jobs/);
 assert.match(route,/activeCount/);
 assert.match(route,/ageMs/);
});

test('Social Arb panel loads bridge status with other point-in-time research data',()=>{
 assert.match(panel,/\/api\/social-arb\/bridge-status/);
 assert.match(panel,/Local bridge online/);
 assert.match(panel,/Local bridge offline/);
 assert.match(panel,/install-autostart\.command/);
});
