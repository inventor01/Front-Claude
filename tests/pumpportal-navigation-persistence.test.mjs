import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('PumpPortal watcher remains root-mounted across internal app navigation',()=>{
  const layout=read('app/layout.tsx');
  const nav=read('app/persistent-navigation.tsx');
  const watcher=read('app/narrative-creation-watcher.tsx');

  assert.match(layout,/import NarrativeCreationWatcher/);
  assert.match(layout,/import PersistentNavigation/);
  assert.match(layout,/<PersistentNavigation \/>/);
  assert.match(layout,/<NarrativeCreationWatcher \/>/);

  assert.match(nav,/useRouter\(\)/);
  assert.match(nav,/document\.addEventListener\('click', handleClick, true\)/);
  assert.match(nav,/url\.origin !== window\.location\.origin/);
  assert.match(nav,/event\.preventDefault\(\)/);
  assert.match(nav,/router\.push\(/);

  assert.match(watcher,/new WebSocket\('wss:\/\/pumpportal\.fun\/api\/data'\)/);
  assert.match(watcher,/method:'subscribeNewToken'/);
  assert.match(watcher,/method:'subscribeMigration'/);
});
