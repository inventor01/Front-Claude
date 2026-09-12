import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../app/front-live-shell.tsx',import.meta.url),'utf8');
const evidenceRoute=fs.readFileSync(new URL('../app/api/browser-evidence/route.ts',import.meta.url),'utf8');
const richRoute=fs.readFileSync(new URL('../app/api/browser-rich/route.ts',import.meta.url),'utf8');

test('home dashboard mounts the live scan shell',()=>{
  assert.match(page,/FrontLiveShell/);
  assert.match(page,/return <FrontLiveShell\/>/);
});

test('live dashboard polls local findings and syncs them before final scan completion',()=>{
  assert.match(shell,/fetch\(`\$\{BRIDGE\}\/live`/);
  assert.match(shell,/setTimeout\(poll,3000\)/);
  assert.match(shell,/saveLive\(fresh,next\.inferredTopics\|\|\[\],scanAt\)/);
  assert.match(shell,/\/api\/browser-evidence/);
  assert.match(shell,/dashboard updating every 3s/);
});

test('live sync is stable across polls and page reloads instead of replaying observations as new',()=>{
  assert.match(shell,/const LIVE_SYNC_KEY='front\.liveSync\.v2'/);
  assert.match(shell,/const scanAt=Number\(next\.startedAt\|\|next\.completedAt\|\|0\)\|\|null/);
  assert.match(shell,/readPersistedSync\(scanAt\)/);
  assert.match(shell,/writePersistedSync\(scanAt,syncedIds\.current,lastTopics\.current\)/);
  assert.match(evidenceRoute,/scanObservedAt\?:unknown/);
  assert.match(evidenceRoute,/SELECT id FROM observations WHERE owner=\? AND observed=\?/);
  assert.match(evidenceRoute,/newEvidence:freshEvidence\.length/);
  assert.match(richRoute,/scanObservedAt\?:unknown/);
  assert.match(richRoute,/stableObservationAt\(body\.scanObservedAt,receivedAt\)/);
});

test('canonical priority feed remounts once when a live scan finishes',()=>{
  assert.match(shell,/if\(wasActive\.current&&!next\.active\)/);
  assert.match(shell,/setRefreshKey\(\(value\)=>value\+1\)/);
  assert.match(shell,/<FrontDesk key=\{refreshKey\}\/>/);
});
