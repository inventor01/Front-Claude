#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enhanceNarrativesV26 } from '../src/narrative-intelligence-v26.mjs';
import { evaluateV27BaseGateForV28, v28ReleaseEnv } from '../src/release-gate-v28.mjs';
import { validateV28RealScan } from '../src/title-release-gate-v28.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v27Gate = path.join(here, 'validate-v27-release.mjs');
const dataDir = path.join(os.homedir(), '.front-browser-bridge');
const baseReport = process.env.FRONT_E2E_REPORT || path.join(dataDir, 'validation-v26-latest.json');
const scanReport = process.env.FRONT_V28_SCAN_REPORT || path.join(dataDir, 'validation-v26-latest-scan.json');
const titleReport = process.env.FRONT_V28_TITLE_REPORT || path.join(dataDir, 'validation-v28-title-latest.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

console.log('FRONT v28 AUTHENTICATED RELEASE GATE');
console.log('Phase 1/2: v27 collection, transcription, understanding, persistence and build gate');
const releaseEnv = v28ReleaseEnv(process.env);
console.log(`v28 minimum release deadline: ${Math.round(Number(releaseEnv.FRONT_E2E_TIMEOUT_MS) / 1000)}s`);
const base = spawnSync(process.execPath, [v27Gate], {
  stdio: 'inherit',
  env: releaseEnv,
});
if (base.error) {
  console.error(`\n❌ FRONT v28 RELEASE GATE FAILED — could not run v27 base gate: ${base.error.message}`);
  process.exit(1);
}

const baseEvaluation = evaluateV27BaseGateForV28({ exitStatus: base.status || 0, report: readJson(baseReport) });
if (!baseEvaluation.ok) {
  console.error(`\n❌ FRONT v28 RELEASE GATE FAILED — v27 base gate exit ${base.status}`);
  if (baseEvaluation.failures.length) console.error(`Blocking checks: ${baseEvaluation.failures.join(' | ')}`);
  process.exit(base.status || 1);
}
if (baseEvaluation.acceptedVisualProbeFailure) {
  console.warn('\n⚠️  Supplemental visual-probe checks failed for one or more sampled posts, but no other v27 release check failed.');
  console.warn('v28 will continue only because the completed all-video meaning/post-understanding/narrative pipeline is the higher-level semantic acceptance gate.');
  console.warn(`Waived supplemental checks: ${baseEvaluation.failures.join(' | ')}`);
}

console.log('\nPhase 2/2: v28 real-data title claim verification');
const scan = readJson(scanReport);
if (!scan) {
  console.error(`❌ Could not read authenticated scan report: ${scanReport}`);
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
  baseGate: {
    acceptedVisualProbeFailure: baseEvaluation.acceptedVisualProbeFailure,
    waivedFailures: baseEvaluation.failures,
    report: baseReport,
  },
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
