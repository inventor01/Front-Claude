import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('PumpPortal connection survives route component unmounts and internal navigation',()=>{
  const layout=read('app/layout.tsx');
  const nav=read('app/persistent-navigation.tsx');
  const watcher=read('app/narrative-creation-watcher.tsx');
  const runtime=read('app/pumpportal-client-runtime.mjs');

  assert.match(layout,/import NarrativeCreationWatcher/);
  assert.match(layout,/import PersistentNavigation/);
  assert.match(layout,/<PersistentNavigation \/>/);
  assert.match(layout,/<NarrativeCreationWatcher \/>/);

  assert.match(nav,/useRouter\(\)/);
  assert.match(nav,/document\.addEventListener\('click', handleClick, true\)/);
  assert.match(nav,/event\.preventDefault\(\)/);
  assert.match(nav,/router\.push\(/);

  assert.match(runtime,/__frontPumpPortalRuntimeV3/);
  assert.match(runtime,/new WebSocket\(SOCKET_URL\)/);
  assert.match(runtime,/method:'subscribeNewToken'/);
  assert.match(runtime,/method:'subscribeMigration'/);
  assert.match(runtime,/runtime\.socket\?\.readyState===WebSocket\.OPEN/);
  assert.match(runtime,/repeated enable|Connected · launches \+ migrations/);

  assert.match(watcher,/subscribePumpPortalRuntime/);
  assert.match(watcher,/subscribePumpPortalMessages/);
  assert.match(watcher,/setPumpPortalRuntimeEnabled/);
  assert.doesNotMatch(watcher,/new WebSocket\(/);
  assert.doesNotMatch(watcher,/socket\?\.close\(\)/);
});
