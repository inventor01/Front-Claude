#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enhanceNarrativesV26 } from '../src/narrative-intelligence-v26.mjs';
import { validateV28RealScan } from '../src/title-release-gate-v28.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v27Gate = path.join(here, 'validate-v27-release.mjs');
const scanReport = process.env.FRONT_V28_SCAN_REPORT || path.join(os.homedir(), '.front-browser-bridge', 'validation-v26-latest-scan.json');
const titleReport = process.env.FRONT_V28_TITLE_REPORT || path.join(os.homedir(), '.front-browser-bridge', 'validation-v28-title-latest.json');

console.log('FRONT v28 AUTHENTICATED RELEASE GATE');
console.log('Phase 1/2: v27 collection, transcription, understanding, persistence and build gate');
const base = spawnSync(process.execPath, [v27Gate], {
  stdio: 'inherit',
  env: { ...process.env, FRONT_RELEASE_GATE: '28' },
});
if (base.error || base.status !== 0) {
  console.error(`\n❌ FRONT v28 RELEASE GATE FAILED — v27 base gate ${base.error?.message || `exit ${base.status}`}`);
  process.exit(base.status || 1);
}

console.log('\nPhase 2/2: v28 real-data title claim verification');
let scan;
try {
  scan = JSON.parse(fs.readFileSync(scanReport, 'utf8'));
} catch (error) {
  console.error(`❌ Could not read authenticated scan report: ${scanReport}`);
  console.error(error?.message || error);
  process.exit(1);
}

const evidence = Array.isArray(scan?.recovery?.evidence)
  ? scan.recovery.evidence
  : Array.isArray(scan?.live?.evidence)
    ? scan.live.evidence
    : Array.isArray(scan?.scan?.evidence)
      ? scan.scan.evidence
      : [];
const emittedTopics = Array.isArray(scan?.scan?.inferredTopics)
  ? scan.scan.inferredTopics
  : Array.isArray(scan?.live?.inferredTopics)
    ? scan.live.inferredTopics
    : [];
const replayedTopics = enhanceNarrativesV26([], evidence, Date.now());
const result = validateV28RealScan({ topics: emittedTopics, replayedTopics });

for (const row of result.emitted) {
  console[row.ok ? 'log' : 'error'](`${row.ok ? '✅' : '❌'} emitted title: ${row.title || '(missing)'}${row.issues.length ? ` — ${row.issues.join('; ')}` : ''}`);
}
for (const row of result.replayed) {
  console[row.ok ? 'log' : 'error'](`${row.ok ? '✅' : '❌'} real-evidence replay: ${row.title || '(missing)'}${row.issues.length ? ` — ${row.issues.join('; ')}` : ''}`);
}
if (result.noQualifiedNarratives) {
  console.warn('⚠️  No real narrative qualified in this sample. This is not a release failure; v28 emitted no unsupported title claims.');
}

const report = {
  at: new Date().toISOString(),
  ok: result.ok,
  scanId: scan?.recovery?.scanId || scan?.live?.scanId || scan?.scan?.scanId || null,
  sourceReport: scanReport,
  evidenceRows: evidence.length,
  ...result,
};
fs.mkdirSync(path.dirname(titleReport), { recursive: true });
fs.writeFileSync(titleReport, JSON.stringify(report, null, 2));

console.log('\n════════════════════════════════════════════════════════');
console.log(result.ok ? '✅ FRONT v28 RELEASE GATE PASSED' : `❌ FRONT v28 RELEASE GATE FAILED (${result.failures.length})`);
console.log(`Emitted titles ${result.counts.emitted} · real-evidence replay titles ${result.counts.replayed} · evidence rows ${evidence.length}`);
console.log(`Report: ${titleReport}`);
console.log('════════════════════════════════════════════════════════');
process.exit(result.ok ? 0 : 1);
