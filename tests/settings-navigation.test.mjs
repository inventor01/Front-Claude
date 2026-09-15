import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/settings/settings-client.tsx',import.meta.url),'utf8');
const settingsPage=fs.readFileSync(new URL('../app/settings/page.tsx',import.meta.url),'utf8');
const ledgerPage=fs.readFileSync(new URL('../app/settings/ledger/page.tsx',import.meta.url),'utf8');
const ledgerClient=fs.readFileSync(new URL('../app/settings/ledger/ledger-client.tsx',import.meta.url),'utf8');

test('settings Back to Front uses client routing so live listeners survive navigation',()=>{
  assert.match(source,/import Link from 'next\/link'/);
  assert.match(source,/<Link className=\{styles\.back\} href="\/">/);
  assert.doesNotMatch(source,/<a className=\{styles\.back\} href="\/">/);
});

test('PumpPortal controls are route-independent and do not own the WebSocket',()=>{
  assert.match(source,/const CONTROL_EVENT='front-pumpportal-control'/);
  assert.match(source,/window\.dispatchEvent\(new CustomEvent\(CONTROL_EVENT/);
  assert.doesNotMatch(source,/new WebSocket\('wss:\/\/pumpportal\.fun\/api\/data'\)/);
  assert.doesNotMatch(source,/socket\?\.close\(\)/);
  assert.match(source,/localStorage\.getItem\(LISTENER_KEY\)==='true'/);
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

test('deep scan wait window allows long visual recovery and points timed-out scans to ledger',()=>{
  assert.match(source,/const DEEP_TIMEOUT_MS=20\*60_000/);
  assert.match(source,/20-minute Settings wait window/);
  assert.match(source,/open Scan Ledger before starting another scan/);
});

test('settings exposes the v26 discovery surfaces, suppresses legacy no-op controls, and respects real sentinel limits',()=>{
  assert.match(source,/checked=\{config\.scanXForYou\?\?true\}/);
  assert.match(source,/checked=\{config\.scanTikTokForYou\?\?true\}/);
  for(const key of ['scanXHome','scanXExplore','scanTikTokTrends','scanTikTokExplore']){
    assert.match(source,new RegExp(`${key}:false`));
    assert.doesNotMatch(source,new RegExp(`checked=\\{config\\.${key}`));
  }
  assert.match(source,/Legacy X Explore\/Home and TikTok Trends\/Explore switches are intentionally disabled/);
  assert.match(source,/Scout sentinels/);
  assert.match(source,/min=\{0\} max=\{15\} value=\{config\.sentinelAccountsPerScout\?\?6\}/);
  assert.match(source,/min=\{0\} max=\{20\} value=\{config\.sentinelAccountsPerDeep\?\?10\}/);
  assert.match(source,/Stale pass limit/);
});

test('zero-result deep scan is surfaced locally instead of posting an empty evidence batch',()=>{
  const zeroGuard=source.indexOf('if(!result.evidence.length)');
  const save=source.indexOf('const stored=await saveEvidence',zeroGuard);
  assert(zeroGuard>0);
  assert(save>zeroGuard);
  assert.match(source,/Deep scan finished with 0 usable evidence records/);
});

test('completed deep scan saves with its stable observation timestamp',()=>{
  assert.match(source,/saveEvidence\(result\.evidence,result\.inferredTopics\|\|\[\],result\.at\)/);
  assert.match(source,/scanObservedAt/);
});

test('settings exposes an authenticated live scan ledger with QA diagnostics',()=>{
  assert.match(settingsPage,/href="\/settings\/ledger"/);
  assert.match(ledgerPage,/requireChatGPTUser\('\/settings\/ledger'\)/);
  assert.match(ledgerClient,/fetch\(`\$\{BRIDGE\}\/ledger`/);
  assert.match(ledgerClient,/setInterval\(\(\)=>void refresh\(true\),2000\)/);
  assert.match(ledgerClient,/Scan health/);
  assert.match(ledgerClient,/Video QA/);
  assert.match(ledgerClient,/Open scanned post/);
});
