import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const server = fs.readFileSync(path.join(root, 'src/server-v25.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const launcher = fs.readFileSync(path.join(root, 'start.command'), 'utf8');

test('v26 is the default browser bridge runtime', () => {
  assert.equal(pkg.scripts.start, 'node src/server-v25.mjs');
  assert.equal(pkg.scripts['start:v26'], 'node src/server-v25.mjs');
  assert.match(launcher, /Starting Front browser bridge v26/);
});

test('v26 preserves the single-process architecture', () => {
  assert.doesNotMatch(server, /launcher-v2[01]\.mjs/);
  assert.doesNotMatch(server, /server-v1[6789]\.mjs/);
  assert.doesNotMatch(server, /child_process/);
  assert.doesNotMatch(server, /spawn\(/);
  assert.match(server, /architecture: 'single-process'/);
  assert.match(server, /scanner: 'front-single-process-v26'/);
});

test('v26 keeps one scan identity and a fresh v26 ledger', () => {
  assert.match(server, /scan-ledger-v26\.json/);
  assert.match(server, /scanId: id/);
  assert.match(server, /single-scan-ledger/);
  assert.doesNotMatch(server, /scan-ledger-v19\.json/);
});

test('v26 exposes contextual post understanding and semantic narrative diagnostics', () => {
  for (const stage of ['chrome', 'xDiscovery', 'tiktokDiscovery', 'visualUnderstanding', 'postUnderstanding', 'narrativeEngine', 'originResearch']) {
    assert.match(server, new RegExp(stage));
  }
  assert.match(server, /PostUnderstandingEngineV26/);
  assert.match(server, /enhanceNarrativesV26/);
  assert.match(server, /contextual-post-understanding/);
  assert.match(server, /semantic-subject-event-clustering/);
  assert.match(server, /generic-word-rejection/);
  assert.match(server, /tiktokDiscovery: latestLive\.stages\?\.tiktokDiscovery/);
  assert.match(server, /owned-tiktok-page/);
  assert.match(server, /owned-x-page/);
});

test('v26 owns only bridge and Chrome CDP ports', () => {
  assert.match(server, /activePorts: \{ bridge: PORT, chromeCdp: CDP_PORT \}/);
  for (const legacyPort of ['43986', '43987', '43988', '43991', '43994']) assert.doesNotMatch(server, new RegExp(legacyPort));
});
