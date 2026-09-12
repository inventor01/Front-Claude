import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server-v16.mjs',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../src/server-v17.mjs',import.meta.url),'utf8');
const supervisor=fs.readFileSync(new URL('../src/server-v18.mjs',import.meta.url),'utf8');
const fallback=fs.readFileSync(new URL('../src/fallback-discovery-v18.mjs',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/fallback-worker-v18.mjs',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('v18 supervisor is default while v17 and v16 remain explicit fallbacks',()=>{
  assert.equal(pkg.scripts.start,'node src/server-v18.mjs');
  assert.equal(pkg.scripts['start:v17'],'node src/server-v17.mjs');
  assert.equal(pkg.scripts['start:v16'],'node src/server-v16.mjs');
  assert.match(server,/version:\s*16/);
  assert.match(server,/scanner:\s*'viral-narrative-scout-v16'/);
  assert.match(gateway,/scanner:\s*'viral-narrative-content-scout-v17'/);
  assert.match(supervisor,/scanner:\s*'viral-narrative-content-scout-v18'/);
});

test('v18 can stop the whole scan tree and guards duplicate manual scans',()=>{
  assert.match(supervisor,/req\.url === '\/stop'/);
  assert.match(supervisor,/process\.kill\(-pid, 'SIGKILL'\)/);
  assert.match(supervisor,/killProcessGroup\(fallbackWorker\)/);
  assert.match(supervisor,/A scan is already running\. Use Stop scan before starting another one\./);
  assert.match(supervisor,/'manual-scan-stop'/);
  assert.match(supervisor,/'duplicate-scan-guard'/);
});

test('v18 zero-result recovery admits caption-light videos before local grounding',()=>{
  assert.match(fallback,/mediaType !== 'video'/);
  assert.match(fallback,/visualCandidate: mediaType === 'video' && !content/);
  assert.match(fallback,/visualCandidate: !content/);
  assert.match(supervisor,/zeroResultFallback\(scanBody, data\)/);
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
