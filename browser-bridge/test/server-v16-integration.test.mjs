import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server-v16.mjs',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../src/server-v17.mjs',import.meta.url),'utf8');
const supervisor=fs.readFileSync(new URL('../src/server-v18.mjs',import.meta.url),'utf8');
const ledgerSupervisor=fs.readFileSync(new URL('../src/server-v19.mjs',import.meta.url),'utf8');
const liveSupervisor=fs.readFileSync(new URL('../src/server-v20.mjs',import.meta.url),'utf8');
const breadthSupervisor=fs.readFileSync(new URL('../src/server-v21.mjs',import.meta.url),'utf8');
const broadTikTokObserver=fs.readFileSync(new URL('../src/tiktok-observer-v21.mjs',import.meta.url),'utf8');
const liveObserver=fs.readFileSync(new URL('../src/live-observer-v20.mjs',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../src/launcher-v20.mjs',import.meta.url),'utf8');
const launcherV21=fs.readFileSync(new URL('../src/launcher-v21.mjs',import.meta.url),'utf8');
const compat=fs.readFileSync(new URL('../src/playwright-cdp-compat.mjs',import.meta.url),'utf8');
const fallback=fs.readFileSync(new URL('../src/fallback-discovery-v18.mjs',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/fallback-worker-v18.mjs',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('v21 TikTok breadth supervisor is default while v20/v19/v18/v17/v16 remain explicit fallbacks',()=>{
  assert.equal(pkg.scripts.start,'node src/launcher-v21.mjs');
  assert.equal(pkg.scripts['start:v20'],'node src/launcher-v20.mjs');
  assert.equal(pkg.scripts['start:v19'],'node src/launcher-v19.mjs');
  assert.equal(pkg.scripts['start:v18'],'node src/server-v18.mjs');
  assert.equal(pkg.scripts['start:v17'],'node src/server-v17.mjs');
  assert.equal(pkg.scripts['start:v16'],'node src/server-v16.mjs');
  assert.match(server,/version:\s*16/);
  assert.match(server,/scanner:\s*'viral-narrative-scout-v16'/);
  assert.match(gateway,/scanner:\s*'viral-narrative-content-scout-v17'/);
  assert.match(supervisor,/scanner:\s*'viral-narrative-content-scout-v18'/);
  assert.match(ledgerSupervisor,/scanner:\s*'viral-narrative-content-scout-v19'/);
  assert.match(liveSupervisor,/scanner:\s*'viral-narrative-content-scout-v20'/);
  assert.match(breadthSupervisor,/scanner:\s*'viral-narrative-content-scout-v21'/);
});

test('v21 retains v20 compatibility preloads and raises only the ranked visual-analysis budget',()=>{
  assert.match(launcherV21,/NODE_OPTIONS/);
  assert.match(launcherV21,/playwright-cdp-compat\.mjs/);
  assert.match(launcherV21,/FRONT_CONTENT_DEEP_VIDEOS \|\|= '8'/);
  assert.match(launcherV21,/FRONT_CONTENT_SCOUT_VIDEOS \|\|= '4'/);
  assert.match(launcher,/NODE_OPTIONS/);
  assert.match(compat,/noDefaults:\s*options\.noDefaults \?\? true/);
  assert.match(compat,/frontCdpNoDefaults = true/);
});

test('v21 observes broad TikTok URLs separately from grounded evidence',()=>{
  assert.match(breadthSupervisor,/url\.pathname === '\/live'/);
  assert.match(breadthSupervisor,/tiktokDiscovery:/);
  assert.match(breadthSupervisor,/'broad-tiktok-observation'/);
  assert.match(breadthSupervisor,/'caption-light-tiktok-discovery'/);
  assert.match(broadTikTokObserver,/a\[href\*="\/video\/"\]/);
  assert.match(broadTikTokObserver,/observed:/);
  assert.match(broadTikTokObserver,/grounded:/);
  assert.match(broadTikTokObserver,/groundedTikTokEvidence/);
});

test('v20 observes live browser pages and exposes progressive evidence without changing quality gates',()=>{
  assert.match(liveSupervisor,/url\.pathname === '\/live'/);
  assert.match(liveSupervisor,/'live-dashboard-stream'/);
  assert.match(liveSupervisor,/'live-evidence-preview'/);
  assert.match(liveObserver,/article\[data-testid="tweet"\]/);
  assert.match(liveObserver,/a\[href\*="\/video\/"\]/);
  assert.match(liveObserver,/detectTopics\(evidence, at, 24\)/);
  assert.match(liveObserver,/rankInvestigationCandidates\(/);
});

test('v20 rejects duplicate scans before v19 can create a misleading ledger entry',()=>{
  assert.match(liveSupervisor,/Could not verify scanner state before starting/);
  assert.match(liveSupervisor,/health\.running \|\| health\.scanLedger\?\.current/);
  assert.match(liveSupervisor,/A scan is already running\. Use Stop scan before starting another one\./);
  assert.match(liveSupervisor,/'fast-duplicate-preflight'/);
});

test('v20 distinguishes a ready Chrome CDP endpoint from an attached Playwright session',()=>{
  assert.match(liveSupervisor,/\/json\/version/);
  assert.match(liveSupervisor,/'cdp-ready'/);
  assert.match(liveSupervisor,/'cdp-ready-status'/);
});

test('v21 persists TikTok breadth diagnostics on top of the readable v19 ledger',()=>{
  assert.match(ledgerSupervisor,/scan-ledger-v19\.json/);
  assert.match(ledgerSupervisor,/url\.pathname === '\/ledger'/);
  assert.match(ledgerSupervisor,/url\.pathname === '\/ledger\/clear'/);
  assert.match(ledgerSupervisor,/sourceCountsFrom\(payload/);
  assert.match(ledgerSupervisor,/evidenceSamples\(evidence\)/);
  assert.match(ledgerSupervisor,/'scan-ledger'/);
  assert.match(ledgerSupervisor,/'live-scan-ledger'/);
  assert.match(ledgerSupervisor,/'cdp-no-defaults-compat'/);
  assert.match(breadthSupervisor,/tiktok-breadth-v21\.json/);
  assert.match(breadthSupervisor,/pathname === '\/ledger'/);
  assert.match(breadthSupervisor,/broadTikTok:/);
});

test('v18 can stop the whole scan tree and guards duplicate manual scans',()=>{
  assert.match(supervisor,/req\.url === '\/stop'/);
  assert.match(supervisor,/process\.kill\(-pid, 'SIGKILL'\)/);
  assert.match(supervisor,/killProcessGroup\(fallbackWorker\)/);
  assert.match(supervisor,/A scan is already running\. Use Stop scan before starting another one\./);
  assert.match(supervisor,/'manual-scan-stop'/);
  assert.match(supervisor,/'duplicate-scan-guard'/);
});

test('v18 visual recovery admits caption-light videos and supplements thin scans before local grounding',()=>{
  assert.match(fallback,/mediaType !== 'video'/);
  assert.match(fallback,/visualCandidate: mediaType === 'video' && !content/);
  assert.match(fallback,/visualCandidate: !content/);
  assert.match(supervisor,/visualRecoveryReason\(scanBody, data/);
  assert.match(supervisor,/visualRecovery\(scanBody, data, reason\)/);
  assert.match(supervisor,/'thin-result-visual-recovery'/);
  assert.match(worker,/collectFallbackEvidence\(/);
  assert.match(worker,/detector\.enrich\(/);
  assert.match(worker,/rows\.filter\(\(row\) => clean\(row\.content, 8000\)\.length >= 3\)/);
});

test('visual fallback topics still require two independently understood creators',()=>{
  assert.match(worker,/supported\.length >= 2 && creators\.size >= 2/);
});

test('adaptive scrolling can stop when the scout finds a qualified signal',()=>{
  assert.match(server,/evaluateDiscoveryPass\(/);
  assert.match(server,/focusSignal\.focus/);
  assert.match(server,/stopReason:\s*focusSignal\.focus\s*\?\s*'signal-found'/);
});

test('focus investigation happens before optional broad trend seeds',()=>{
  const focus=server.indexOf("'Focus Investigation'");
  const explore=server.indexOf("add('X Trending seeds'");
  assert(focus>0&&explore>focus);
  assert.match(server,/if \(active\.scanXExplore && !earlyPlan\.reduceBroadSeeds\)/);
  assert.match(server,/sentinelCount = earlyPlan\.reduceBroadSeeds/);
});

test('metric snapshots are persisted and included in scan audit',()=>{
  assert.match(server,/metric-snapshots-v16\.json/);
  assert.match(server,/attachObservedMetricVelocity\(result, metricSnapshotState, at\)/);
  assert.match(server,/writeJson\(metricSnapshotPath, metricSnapshotState\)/);
  assert.match(server,/measuredVelocityPosts:/);
});

test('new visual-only topics require two independently understood creators',()=>{
  assert.match(gateway,/support\.evidence < 2 \|\| support\.creators < 2/);
  assert.match(gateway,/contentUnderstandingCreators/);
});

test('pending background evidence re-derives topics from cached video understanding',()=>{
  assert.match(gateway,/req\.url === '\/pending'/);
  assert.match(gateway,/deriveTopicsFromContent\(evidence, Date\.now\(\)\)/);
  assert.match(gateway,/lastTopics = understood/);
});
