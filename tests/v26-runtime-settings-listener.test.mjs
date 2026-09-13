import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('local vision defaults match the proven 8 GB Mac profile and do not cap discovery',()=>{
  const env=read('browser-bridge/content.env');
  const example=read('browser-bridge/content.env.example');
  assert.match(env,/FRONT_OLLAMA_MODEL=qwen3-vl:4b-instruct/);
  assert.match(env,/FRONT_CONTENT_DEEP_VIDEOS=4/);
  assert.match(env,/FRONT_CONTENT_SCOUT_VIDEOS=2/);
  assert.match(env,/FRONT_CONTENT_BACKGROUND_VIDEOS=1/);
  assert.match(example,/cap EXPENSIVE visual analysis, not X\/TikTok discovery/);
});

test('settings does not own a PumpPortal websocket and legacy no-op trend toggles are disabled',()=>{
  const source=read('app/settings/settings-client.tsx');
  assert.doesNotMatch(source,/new WebSocket\(/);
  assert.match(source,/scanXExplore:false/);
  assert.match(source,/scanXHome:false/);
  assert.match(source,/scanTikTokTrends:false/);
  assert.match(source,/scanTikTokExplore:false/);
  assert.doesNotMatch(source,/<b>X Explore seeds<\/b>/);
  assert.doesNotMatch(source,/<b>TikTok Trends<\/b>/);
  assert.match(source,/front-pumpportal-control/);
  assert.match(source,/stays alive when you leave Settings/);
});

test('one root-mounted browser lifecycle watcher subscribes to launches and migrations',()=>{
  const layout=read('app/layout.tsx');
  const watcher=read('app/narrative-creation-watcher.tsx');
  assert.match(layout,/import NarrativeCreationWatcher/);
  assert.match(layout,/<NarrativeCreationWatcher \/>/);
  assert.match(watcher,/method:'subscribeNewToken'/);
  assert.match(watcher,/method:'subscribeMigration'/);
  assert.match(watcher,/data\.txType==='migrate'/);
  assert.match(watcher,/isPumpPortalCreation\(data\)/);
  assert.match(watcher,/front\.pumpPortalListenerEnabled\.v2/);
  assert.match(watcher,/priorMatch.*priorHit/s);
  assert.doesNotMatch(watcher,/browser\.close\(/);
});

test('migration alerts remain distinct from creation alerts',()=>{
  const watcher=read('app/narrative-creation-watcher.tsx');
  assert.match(watcher,/event:'create'/);
  assert.match(watcher,/event:'migrate'/);
  assert.match(watcher,/Migration observed/);
  assert.match(watcher,/Pump\.fun creation observed/);
  assert.match(watcher,/if\(!priorMatch&&!priorHit\)return/);
});
