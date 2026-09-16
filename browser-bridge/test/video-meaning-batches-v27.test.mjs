import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planMeaningBatches,
  analyzeTextBatchResilient,
  recoverFailedTextMeanings,
  representativeMeaningTranscript,
  analyzeVisualOne,
  hasCompactMeaningEvidence,
  analyzeLowTextVideoMeaning,
} from '../src/video-meaning-v27.mjs';

test('local semantic batches preserve every full input within a bounded prompt', () => {
  const rows = Array.from({ length: 9 }, (_, id) => ({ id, content: 'caption', transcript: 'spoken evidence '.repeat(150) }));
  const batches = planMeaningBatches(rows, 8, 'ollama');
  assert.deepEqual(batches.flat(), rows);
  assert.ok(batches.every(batch => batch.length <= 4));
  assert.ok(batches.length > 3, 'long transcripts split before row-count limit');
  assert.equal(planMeaningBatches(rows, 8, 'openai')[0].length, 8);
});

test('representative long transcript keeps evidence from beginning middle and end', () => {
  const transcript = [
    'BEGINNING alpha signal '.repeat(80),
    'QUARTER beta signal '.repeat(80),
    'MIDDLE gamma narrative '.repeat(80),
    'THREEQUARTER delta signal '.repeat(80),
    'ENDING omega signal '.repeat(80),
  ].join(' ');
  const sampled = representativeMeaningTranscript(transcript, 1800, 5);
  assert.ok(sampled.length <= 1800);
  assert.match(sampled, /BEGINNING/i);
  assert.match(sampled, /MIDDLE/i);
  assert.match(sampled, /ENDING/i);
});

test('one failed semantic row does not discard or prevent successful sibling retries', async () => {
  const rows = [{ id: 'bad' }, { id: 'good' }, { id: 'also-good' }];
  const analyzed = [];
  const values = await analyzeTextBatchResilient(rows, {}, 1000, async batch => {
    analyzed.push(batch.map(row => row.id));
    if (batch.some(row => row.id === 'bad')) throw new Error('bad response');
    return batch.map((row, i) => ({ i, a: `${row.id} explains a new telescope launch`, s: 'telescope', e: 'launch', c: .9 }));
  });
  assert.equal(values[0].videoMeaningStatus, 'failed');
  assert.equal(values[1].videoMeaningStatus, 'modeled');
  assert.equal(values[2].videoMeaningStatus, 'modeled');
  assert.ok(analyzed.some(batch => batch.includes('also-good')));
});

test('weak meaning remains failed after retry rather than incrementing completed', async () => {
  const result = await analyzeTextBatchResilient([{ id: 1 }], {}, 1000, async () => [{ i: 0, a: 'uncertain activity', c: .1 }]);
  assert.equal(result[0].videoMeaningStatus, 'failed');
});

test('isolated text-meaning failure uses compact text recovery before visual page recovery', async () => {
  const failures = [{
    row: { id: 'recover-compact', platform: 'X', content: 'caption evidence', transcript: 'spoken evidence' },
    value: { videoMeaningStatus: 'failed', videoMeaningConfidence: 0, videoMeaningError: 'text model timed out' },
  }];
  let compactCalls = 0;
  let visualCalls = 0;
  const result = await recoverFailedTextMeanings({}, failures, { provider: 'ollama' }, {
    timeoutMs: 1000,
    analyzeCompact: async () => {
      compactCalls++;
      return {
        videoAbout: 'A creator explains a telescope launch using the spoken evidence.',
        videoSubject: 'telescope launch',
        videoEvent: 'explains launch',
        videoMeaningConfidence: .88,
        videoMeaningMethod: 'semantic-compact-recovery',
        videoMeaningStatus: 'modeled',
        videoMeaningAt: Date.now(),
      };
    },
    analyzeVisual: async () => {
      visualCalls++;
      throw new Error('visual should not run');
    },
  });
  assert.equal(compactCalls, 1);
  assert.equal(visualCalls, 0);
  assert.equal(result[0].recovered, true);
  assert.equal(result[0].recoveryMethod, 'semantic-compact-recovery');
  assert.equal(result[0].value.videoMeaningStatus, 'modeled');
});

test('failed compact recovery falls through to grounded visual recovery', async () => {
  const failures = [{
    row: { id: 'recover-me', platform: 'X', content: 'caption evidence', transcript: 'spoken evidence' },
    value: { videoMeaningStatus: 'failed', videoMeaningConfidence: 0, videoMeaningError: 'text model timed out' },
  }];
  const calls = [];
  const result = await recoverFailedTextMeanings({}, failures, { provider: 'ollama' }, {
    timeoutMs: 1000,
    concurrency: 2,
    analyzeCompact: async () => { throw new Error('compact invalid JSON'); },
    analyzeVisual: async (_context, row, provider, signal) => {
      calls.push({ id: row.id, provider: provider.provider, aborted: signal.aborted });
      return {
        videoAbout: 'A person explains a telescope launch using the spoken evidence and visible scene.',
        videoSubject: 'telescope launch',
        videoEvent: 'explains launch',
        videoMeaningConfidence: .86,
        videoMeaningMethod: 'visual-fallback-model',
        videoMeaningStatus: 'modeled',
        videoMeaningAt: Date.now(),
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'recover-me');
  assert.equal(result[0].recovered, true);
  assert.equal(result[0].recoveryMethod, 'visual-fallback-model');
  assert.equal(result[0].value.videoMeaningStatus, 'modeled');
  assert.ok(result[0].value.videoMeaningConfidence >= .4);
});

test('both recovery paths failing keeps row failed and preserves diagnostics', async () => {
  const failures = [{
    row: { id: 'still-bad', platform: 'TikTok', content: 'caption' },
    value: { videoMeaningStatus: 'failed', videoMeaningConfidence: 0, videoMeaningError: 'invalid text response' },
  }];
  const result = await recoverFailedTextMeanings({}, failures, { provider: 'ollama' }, {
    timeoutMs: 1000,
    analyzeCompact: async () => { throw new Error('compact invalid'); },
    analyzeVisual: async () => ({
      videoAbout: 'generic clip',
      videoMeaningConfidence: .2,
      videoMeaningMethod: 'visual-fallback-model',
      videoMeaningStatus: 'modeled',
    }),
  });
  assert.equal(result[0].recovered, false);
  assert.equal(result[0].value.videoMeaningStatus, 'failed');
  assert.match(result[0].value.videoMeaningError, /invalid text response/i);
  assert.match(result[0].value.videoMeaningError, /compact recovery/i);
  assert.match(result[0].value.videoMeaningError, /visual recovery/i);
});


test('visual inference owns a fresh timeout budget after frame acquisition', async () => {
  const originalFetch = globalThis.fetch;
  const stale = new AbortController();
  stale.abort();

  let inferenceSignalWasAborted = true;

  globalThis.fetch = async (_url, options = {}) => {
    inferenceSignalWasAborted = Boolean(options.signal?.aborted);
    return {
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            a: 'A person performs a dance in the visible video frame.',
            s: 'person dancing',
            e: 'performs dance',
            c: 0.88
          })
        }
      })
    };
  };

  try {
    const result = await analyzeVisualOne(
      {},
      {
        id: 'fresh-visual-budget',
        platform: 'TikTok',
        content: '',
        transcript: '',
        videoFrame: 'ZmFrZQ=='
      },
      {
        provider: 'ollama',
        endpoint: 'http://unit.test',
        model: 'qwen-test'
      },
      stale.signal
    );

    assert.equal(inferenceSignalWasAborted, false);
    assert.equal(result.videoMeaningStatus, 'modeled');
    assert.ok(result.videoMeaningConfidence >= .4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('compact evidence classifier distinguishes useful low-text clues from social boilerplate', () => {
  assert.equal(
    hasCompactMeaningEvidence({
      platform: 'TikTok',
      content: '#🐍 #bite',
      transcript: ''
    }),
    true
  );

  assert.equal(
    hasCompactMeaningEvidence({
      platform: 'TikTok',
      content: '😂😂😂 #viral #fyp @Pat',
      transcript: ''
    }),
    false
  );

  assert.equal(
    hasCompactMeaningEvidence({
      platform: 'TikTok',
      content: '10:54 PM',
      transcript: ''
    }),
    false
  );
});

test('compact low-text evidence avoids unnecessary visual inference', async () => {
  let compactCalls = 0;
  let visualCalls = 0;

  const result = await analyzeLowTextVideoMeaning(
    {},
    {
      id: 'snake-bite',
      platform: 'TikTok',
      content: '#🐍 #bite',
      transcript: ''
    },
    {provider:'ollama'},
    {
      timeoutMs: 1000,
      compactTimeoutMs: 100,
      analyzeCompact: async () => {
        compactCalls++;
        return {
          videoAbout:
            'The caption specifically references a snake bite.',
          videoSubject: 'snake bite',
          videoEvent: 'references snake bite',
          videoMeaningConfidence: .82,
          videoMeaningMethod: 'semantic-compact-recovery',
          videoMeaningStatus: 'modeled',
          videoMeaningAt: Date.now()
        };
      },
      analyzeVisual: async () => {
        visualCalls++;
        throw new Error('visual model should not run');
      }
    }
  );

  assert.equal(compactCalls, 1);
  assert.equal(visualCalls, 0);
  assert.equal(result.value.videoMeaningStatus, 'modeled');
  assert.equal(
    result.recoveryMethod,
    'semantic-compact-recovery'
  );
});

test('generic low-text evidence still requires grounded visual inference', async () => {
  let compactCalls = 0;
  let visualCalls = 0;

  const result = await analyzeLowTextVideoMeaning(
    {},
    {
      id: 'generic',
      platform: 'TikTok',
      content: '😂😂😂 #viral #fyp @Pat',
      transcript: ''
    },
    {provider:'ollama'},
    {
      timeoutMs: 1000,
      analyzeCompact: async () => {
        compactCalls++;
        throw new Error('compact should not run');
      },
      analyzeVisual: async () => {
        visualCalls++;
        return {
          videoAbout: 'A person is visibly dancing.',
          videoSubject: 'person dancing',
          videoEvent: 'performs dance',
          videoMeaningConfidence: .84,
          videoMeaningMethod: 'visual-fallback-model',
          videoMeaningStatus: 'modeled',
          videoMeaningAt: Date.now()
        };
      }
    }
  );

  assert.equal(compactCalls, 0);
  assert.equal(visualCalls, 1);
  assert.equal(result.value.videoMeaningStatus, 'modeled');
});
