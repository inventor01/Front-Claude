import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const maintenance=fs.readFileSync(new URL('../app/api/agent/scroll-jobs/maintenance/route.ts',import.meta.url),'utf8');
const scheduler=fs.readFileSync(new URL('../scripts/social-arb-scheduler.mjs',import.meta.url),'utf8');

test('queue maintenance exposes bounded bridge readiness without secrets',()=>{
 assert.match(maintenance,/bridge:\{online:bridgeOnline/);
 assert.match(maintenance,/scannerReady/);
 assert.match(maintenance,/chromeReady/);
 assert.match(maintenance,/ready:bridgeOnline&&scannerReady&&chromeReady/);
 assert.doesNotMatch(maintenance,/FRONT_BRIDGE_API_KEY/);
});

test('autoscan refuses to create browser work while local bridge is unavailable',()=>{
 assert.match(scheduler,/bridgeReady=maintenance\?\.bridge\?\.ready===true/);
 assert.match(scheduler,/bridge offline/);
 assert.match(scheduler,/scanner not ready/);
 assert.match(scheduler,/chrome not ready/);
 assert.match(scheduler,/if\(!bridgeReady\)return/);
});

test('outcome refresh remains allowed even while browser bridge is offline',()=>{
 const outcomeIndex=scheduler.indexOf("'/api/social-arb/outcomes'");
 const gateIndex=scheduler.indexOf('if(!bridgeReady)return;');
 assert.ok(outcomeIndex>=0&&gateIndex>outcomeIndex);
});
