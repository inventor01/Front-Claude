import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/settings/settings-client.tsx',import.meta.url),'utf8');

test('settings Back to Front uses a hard navigation instead of client Link routing',()=>{
  assert.match(source,/<a className=\{styles\.back\} href="\/">/);
  assert.doesNotMatch(source,/import Link from 'next\/link'/);
});

test('background health polling does not overwrite unsaved scanner form state',()=>{
  assert.match(source,/async function ping\(silent=false,hydrateConfig=false\)/);
  assert.match(source,/if\(hydrateConfig\|\|!configHydrated\.current\)/);
  assert.match(source,/setInterval\(\(\)=>\{void ping\(true,false\);\},30_000\)/);
});
