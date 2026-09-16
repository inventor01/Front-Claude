import test from 'node:test';
import assert from 'node:assert/strict';
import { V28_RELEASE_TIMEOUT_MS, evaluateV27BaseGateForV28, v28ReleaseEnv } from '../src/release-gate-v28.mjs';

test('v28 release gate enforces the validated 20 minute minimum', () => {
  assert.equal(v28ReleaseEnv({}).FRONT_E2E_TIMEOUT_MS, String(V28_RELEASE_TIMEOUT_MS));
  assert.equal(v28ReleaseEnv({ FRONT_E2E_TIMEOUT_MS: '720000' }).FRONT_E2E_TIMEOUT_MS, '1200000');
  assert.equal(v28ReleaseEnv({ FRONT_E2E_TIMEOUT_MS: '1500000' }).FRONT_E2E_TIMEOUT_MS, '1500000');
});

test('green v27 base gate is accepted', () => {
  assert.deepEqual(evaluateV27BaseGateForV28({ exitStatus: 0 }), { ok: true, acceptedVisualProbeFailure: false, failures: [] });
});

test('visual-probe-only failure can be superseded by v28 end-to-end semantic gate', () => {
  const result = evaluateV27BaseGateForV28({ exitStatus: 1, report: { failures: [
    { name: 'Visual understanding complete' },
    { name: 'Qwen/video understanding actually exercised' },
    { name: 'Visual understanding has zero failures' },
    { name: 'At least one visual summary exists' },
    { name: 'Content understanding remains healthy' },
  ] } });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedVisualProbeFailure, true);
});

test('timeout or incomplete semantic pipeline can never be waived', () => {
  const result = evaluateV27BaseGateForV28({ exitStatus: 1, report: { failures: [
    { name: 'Visual understanding complete' },
    { name: 'Scan transport and lifecycle completed' },
    { name: 'Every collected video received semantic meaning' },
  ] } });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' | '), /Scan transport/);
});
