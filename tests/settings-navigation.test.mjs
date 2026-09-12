import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/settings/settings-client.tsx',import.meta.url),'utf8');
const settingsPage=fs.readFileSync(new URL('../app/settings/page.tsx',import.meta.url),'utf8');
const ledgerPage=fs.readFileSync(new URL('../app/settings/ledger/page.tsx',import.meta.url),'utf8');
const ledgerClient=fs.readFileSync(new URL('../app/settings/ledger/ledger-client.tsx',import.meta.url),'utf8');

test('settings Back to Front uses a hard navigation instead of client Link routing',()=>{
  assert.match(source,/<a className=\{styles\.back\} href="\/">/);
  assert.doesNotMatch(source,/import Link from 'next\/link'/);
});

test('background health polling does not overwrite unsaved scanner form state',()=>{
  assert.match(source,/async function ping\(silent=false,hydrateConfig=false\)/);
  assert.match(source,/if\(hydrateConfig\|\|!configHydrated\.current\)/);
  assert.match(source,/setInterval\(\(\)=>\{void ping\(true,false\);\},30_000\)/);
});

test('settings can stop an active local scan and blocks duplicate deep scans',()=>{
  assert.match(source,/async function stopScan\(\)/);
  assert.match(source,/local<\{message\?:string;stopped\?:boolean;restarted\?:boolean\}>\('\/stop'/);
  assert.match(source,/>Stop scan<|\{stopping\?'Stopping…':'Stop scan'\}/);
  assert.match(source,/Boolean\(health\?\.running\)/);
});

test('zero-result deep scan is surfaced locally instead of posting an empty evidence batch',()=>{
  const zeroGuard=source.indexOf('if(!result.evidence.length)');
  const save=source.indexOf('const stored=await saveEvidence',zeroGuard);
  assert(zeroGuard>0);
  assert(save>zeroGuard);
  assert.match(source,/Deep scan finished with 0 usable evidence records/);
});

test('settings exposes an authenticated live scan ledger',()=>{
  assert.match(settingsPage,/href="\/settings\/ledger"/);
  assert.match(ledgerPage,/requireChatGPTUser\('\/settings\/ledger'\)/);
  assert.match(ledgerClient,/fetch\(`\$\{BRIDGE\}\/ledger`/);
  assert.match(ledgerClient,/setInterval\(\(\)=>void refresh\(true\),2000\)/);
  assert.match(ledgerClient,/Open scanned post/);
});
