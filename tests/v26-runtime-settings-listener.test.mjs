import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('local vision defaults match the proven 8 GB Mac profile and do not cap discovery',()=>{
  const env=read('browser-bridge/content.env');
  const example=read('browser-bridge/content.env.example');
  const start=read('browser-bridge/start.command');
  const warm=read('browser-bridge/scripts/warm-ollama.mjs');
  assert.match(env,/FRONT_OLLAMA_MODEL=qwen3-vl:4b-instruct/);
  assert.match(env,/FRONT_OLLAMA_KEEP_ALIVE=30m/);
  assert.match(env,/FRONT_OLLAMA_PREWARM=1/);
  assert.match(env,/FRONT_CONTENT_MODEL_FRAMES=8/);
  assert.match(env,/FRONT_CONTENT_TIMEOUT_MS=60000/);
  assert.match(env,/FRONT_CONTENT_SCOUT_TIMEOUT_MS=45000/);
  assert.match(env,/FRONT_CONTENT_NUM_PREDICT=420/);
  assert.match(env,/FRONT_CONTENT_DEEP_VIDEOS=4/);
  assert.match(env,/FRONT_CONTENT_SCOUT_VIDEOS=2/);
  assert.match(env,/FRONT_CONTENT_BACKGROUND_VIDEOS=1/);
  assert.match(env,/FRONT_CONTEXT_OLLAMA_MODEL=qwen3-vl:4b-instruct/);
  assert.match(env,/FRONT_CONTEXT_MAX_POSTS=12/);
  assert.match(env,/FRONT_CONTEXT_BATCH_SIZE=4/);
  assert.match(env,/FRONT_CONTEXT_TIMEOUT_MS=60000/);
  assert.match(env,/FRONT_CONTEXT_NUM_PREDICT=900/);
  assert.match(example,/cap EXPENSIVE visual\/semantic analysis, not X\/TikTok discovery/);
  assert.match(example,/keep visual and contextual understanding on the same model/);
  assert.match(start,/DEFAULT_CONTENT_ENV=.*content\.env/);
  assert.match(start,/FRONT_OLLAMA_MODEL:-qwen3-vl:4b-instruct/);
  assert.match(start,/FRONT_OLLAMA_KEEP_ALIVE:-30m/);
  assert.match(start,/FRONT_OLLAMA_PREWARM:-1/);
  assert.match(start,/FRONT_CONTENT_MODEL_FRAMES:-8/);
  assert.match(start,/FRONT_CONTENT_TIMEOUT_MS:-60000/);
  assert.match(start,/FRONT_CONTENT_SCOUT_TIMEOUT_MS:-45000/);
  assert.match(start,/FRONT_CONTENT_NUM_PREDICT:-420/);
  assert.match(start,/FRONT_CONTENT_DEEP_VIDEOS:-4/);
  assert.match(start,/FRONT_CONTENT_SCOUT_VIDEOS:-2/);
  assert.match(start,/FRONT_CONTEXT_MAX_POSTS:-12/);
  assert.match(start,/FRONT_CONTEXT_BATCH_SIZE:-4/);
  assert.match(start,/FRONT_CONTEXT_TIMEOUT_MS:-60000/);
  assert.match(start,/FRONT_CONTEXT_NUM_PREDICT:-900/);
  assert.match(start,/scripts\/warm-ollama\.mjs/);
  assert.match(start,/replacing stale qwen3-vl:8b local default/);
  assert.match(start,/replacing stale deep visual budget 8 with balanced budget 4/);
  assert.match(start,/replacing stale scout visual budget 4 with balanced budget 2/);
  assert.match(start,/replacing stale background visual budget 2 with balanced budget 1/);
  assert.match(start,/replacing stale contextual post budget \$FRONT_CONTEXT_MAX_POSTS with balanced budget 12/);
  assert.match(start,/\[ "\$FRONT_CONTEXT_MAX_POSTS" = "90" \].*\[ "\$FRONT_CONTEXT_MAX_POSTS" = "36" \]/s);
  assert.match(start,/replacing stale context batch size 8 with balanced batch size 4/);
  assert.match(start,/replacing stale context timeout 45000ms with validated 60000ms/);
  assert.match(start,/FRONT_CONTEXT_OLLAMA_MODEL:-\$FRONT_OLLAMA_MODEL/);
  assert.match(start,/replacing stale 8B context model with current local model/);
  assert.match(warm,/keep_alive: keepAlive/);
  assert.match(warm,/num_predict: 4/);
  assert.match(warm,/FRONT_OLLAMA_WARM_TIMEOUT_MS/);
});

test('browser bridge launcher remains valid bash after runtime-profile migrations',()=>{
  const result=spawnSync('bash',['-n',path.join(root,'browser-bridge/start.command')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
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
  const background=read('scripts/pumpportal-watcher.mjs');
  const route=read('app/api/internal/launch-watch/route.ts');
  assert.match(watcher,/event:'create'/);
  assert.match(watcher,/event:'migrate'/);
  assert.match(watcher,/Migration observed/);
  assert.match(watcher,/Pump\.fun creation observed/);
  assert.match(watcher,/if\(!priorMatch&&!priorHit\)return/);
  assert.match(background,/method:'subscribeNewToken'/);
  assert.match(background,/method:'subscribeMigration'/);
  assert.match(background,/data\?\.txType==='migrate'/);
  assert.match(route,/raw\.txType==='migrate'/);
  assert.match(route,/migrationObservedAt:seen/);
  assert.match(route,/Only PumpPortal create and migrate events are accepted/);
  assert.match(route,/creationObservedAt:seen/);
});