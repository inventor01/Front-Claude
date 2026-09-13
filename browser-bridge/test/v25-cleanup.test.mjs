import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const server = fs.readFileSync(path.join(root, 'src/server-v25.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const launcher = fs.readFileSync(path.join(root, 'start.command'), 'utf8');

test('v25 is the default browser bridge runtime', () => {
  assert.equal(pkg.scripts.start, 'node src/server-v25.mjs');
  assert.equal(pkg.scripts['start:v25'], 'node src/server-v25.mjs');
  assert.match(launcher, /Starting Front browser bridge v25/);
});

test('v25 does not launch the legacy HTTP proxy chain', () => {
  assert.doesNotMatch(server, /launcher-v2[01]\.mjs/);
  assert.doesNotMatch(server, /server-v1[6789]\.mjs/);
  assert.doesNotMatch(server, /child_process/);
  assert.doesNotMatch(server, /spawn\(/);
  assert.match(server, /architecture: 'single-process'/);
});

test('v25 keeps one scan identity and a fresh v25 ledger', () => {
  assert.match(server, /scan-ledger-v25\.json/);
  assert.match(server, /scanId: id/);
  assert.match(server, /single-scan-ledger/);
  assert.doesNotMatch(server, /scan-ledger-v19\.json/);
});

test('v25 exposes explicit pipeline diagnostics and backward-compatible TikTok live state', () => {
  for (const stage of ['chrome', 'xDiscovery', 'tiktokDiscovery', 'visualUnderstanding', 'narrativeEngine', 'originResearch']) {
    assert.match(server, new RegExp(stage));
  }
  assert.match(server, /tiktokDiscovery: latestLive\.stages\?\.tiktokDiscovery/);
  assert.match(server, /owned-tiktok-page/);
  assert.match(server, /owned-x-page/);
});

test('v25 owns only bridge and Chrome CDP ports', () => {
  assert.match(server, /activePorts: \{ bridge: PORT, chromeCdp: CDP_PORT \}/);
  for (const legacyPort of ['43986', '43987', '43988', '43991', '43994']) assert.doesNotMatch(server, new RegExp(legacyPort));
});
