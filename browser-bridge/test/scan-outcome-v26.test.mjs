import test from 'node:test';
import assert from 'node:assert/strict';
import { scanOutcome } from '../src/scan-outcome-v26.mjs';

test('nonempty evidence cannot hide model or collector failures', () => {
  for (const stage of [{status:'degraded',failed:1},{status:'complete',errors:['renderer failed']}]) {
    const outcome = scanOutcome({evidenceCount:20,stages:{model:stage}});
    assert.equal(outcome.status,'failed');
    assert.equal(outcome.errors.length,1);
  }
  assert.equal(scanOutcome({evidenceCount:20,stages:{model:{status:'complete',failed:0}}}).status,'complete');
  assert.equal(scanOutcome({stopped:true,evidenceCount:20}).status,'stopped');
});

test('one working platform cannot conceal an empty requested collector', () => {
  assert.equal(scanOutcome({evidenceCount:10,stages:{xDiscovery:{status:'complete',observed:10},tiktokDiscovery:{status:'complete',observed:0}}}).status,'failed');
  assert.equal(scanOutcome({evidenceCount:10,stages:{xDiscovery:{status:'complete',observed:10},tiktokDiscovery:{status:'disabled',observed:0}}}).status,'complete');
});

test('partial visual-understanding timeout does not fail an evidence-bearing scan', () => {
  const outcome = scanOutcome({
    evidenceCount: 83,
    stages: {
      xDiscovery: { status: 'complete', observed: 25 },
      tiktokDiscovery: { status: 'complete', observed: 58 },
      visualUnderstanding: { status: 'degraded', failed: 1, errors: ['Content analysis timed out.'] },
      videoMeaning: { status: 'complete', failed: 0 },
      postUnderstanding: { status: 'complete', failed: 0 },
    },
    errors: [],
  });

  assert.equal(outcome.status, 'complete');
  assert.deepEqual(outcome.fatalErrors, []);
  assert.equal(outcome.warnings.length, 1);
  assert.match(outcome.warnings[0], /visualUnderstanding: degraded \(1 failures\): Content analysis timed out\./);
});

test('fully failed visual-understanding stage remains release-blocking', () => {
  const outcome = scanOutcome({
    evidenceCount: 83,
    stages: {
      xDiscovery: { status: 'complete', observed: 25 },
      tiktokDiscovery: { status: 'complete', observed: 58 },
      visualUnderstanding: { status: 'failed', failed: 1, errors: ['model unavailable'] },
    },
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.fatalErrors.length, 1);
  assert.match(outcome.fatalErrors[0], /visualUnderstanding: failed/);
});

test('degraded critical stages still fail the scan', () => {
  const outcome = scanOutcome({
    evidenceCount: 83,
    stages: {
      xDiscovery: { status: 'complete', observed: 25 },
      tiktokDiscovery: { status: 'complete', observed: 58 },
      videoMeaning: { status: 'degraded', failed: 1, errors: ['meaning stage timed out'] },
    },
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.warnings.length, 0);
});
