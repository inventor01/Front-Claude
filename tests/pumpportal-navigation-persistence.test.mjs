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
  assert.doesNotMatch(runtime,/method:'subscribeMigration'/);
  assert.match(runtime,/runtime\.socket\?\.readyState===WebSocket\.OPEN/);
  assert.match(runtime,/Connected · creations only/);

  assert.match(watcher,/subscribePumpPortalRuntime/);
  assert.match(watcher,/subscribePumpPortalMessages/);
  assert.match(watcher,/setPumpPortalRuntimeEnabled/);
  assert.doesNotMatch(watcher,/new WebSocket\(/);
  assert.doesNotMatch(watcher,/socket\?\.close\(\)/);
});

test('browser launch alert permission and creation notification wiring stay intact',()=>{
  const layout=read('app/layout.tsx');
  const settings=read('app/settings/settings-client.tsx');
  const watcher=read('app/narrative-creation-watcher.tsx');
  const runtime=read('app/pumpportal-client-runtime.mjs');

  assert.match(layout,/<NarrativeCreationWatcher \/>/,'the notification watcher must stay mounted at app scope');
  assert.match(settings,/Notification\.requestPermission\(\)/,'Settings must request notification permission from a user action');
  assert.match(settings,/onClick=\{\(\)=>void requestAlerts\(\)\}/,'the Browser alerts button must invoke the permission request');
  assert.match(settings,/<Bell size=\{14\}\/> Browser alerts/);

  assert.match(watcher,/Notification\.permission==='granted'/,'notifications must remain permission-gated');
  assert.match(watcher,/new Notification\(title,\{body\}\)/);
  assert.match(watcher,/notify\('Front launch alert'/,'exact-name creation watches must issue a browser alert');
  assert.match(watcher,/notify\('NEW MATCHING COIN'/,'strong narrative creation matches must issue a browser alert');
  assert.match(watcher,/const exact=watchesRef\.current\.find/,'exact-name watch matching must remain wired');

  assert.match(runtime,/method:'subscribeNewToken'/,'browser alerts must receive PumpPortal creation events');
  assert.doesNotMatch(runtime,/method:'subscribeMigration'/,'browser runtime intentionally stays creation-only; migrations are handled separately');
});

test('Coin Lifecycle can collapse without unmounting live lifecycle monitoring',()=>{
  const watcher=read('app/narrative-creation-watcher.tsx');

  assert.match(watcher,/const PANEL_KEY='front\.coinLifecycleCollapsed\.v1'/,'collapse preference should have a dedicated persisted key');
  assert.match(watcher,/const \[collapsed,setCollapsed\]=useState\(false\)/,'panel needs independent presentation state');
  assert.match(watcher,/localStorage\.getItem\(PANEL_KEY\)==='1'/,'saved collapse preference should be restored');
  assert.match(watcher,/localStorage\.setItem\(PANEL_KEY,next\?'1':'0'\)/,'collapse preference should persist');
  assert.match(watcher,/aria-label=\{collapsed\?'Expand Coin Lifecycle':'Collapse Coin Lifecycle'\}/,'toggle must remain accessible');
  assert.match(watcher,/aria-expanded=\{!collapsed\}/,'toggle must expose expanded state');
  assert.match(watcher,/\{!collapsed&&<>/,'only panel detail rows should be visually collapsed');

  const subscription=watcher.indexOf('subscribePumpPortalMessages');
  const collapsedRender=watcher.indexOf('{!collapsed&&<>');
  assert.ok(subscription>=0&&collapsedRender>subscription,'PumpPortal subscription must stay outside the collapsed render branch');
});
