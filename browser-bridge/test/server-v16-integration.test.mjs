import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server-v16.mjs',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('v16 is the default local browser bridge',()=>{
  assert.equal(pkg.scripts.start,'node src/server-v16.mjs');
  assert.match(server,/version:\s*16/);
  assert.match(server,/scanner:\s*'viral-narrative-scout-v16'/);
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
