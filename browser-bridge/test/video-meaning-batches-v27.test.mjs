import test from 'node:test';
import assert from 'node:assert/strict';
import { planMeaningBatches, analyzeTextBatchResilient } from '../src/video-meaning-v27.mjs';

test('local semantic batches preserve every full input within a bounded prompt', () => {
  const rows = Array.from({ length: 9 }, (_, id) => ({ id, content: 'caption', transcript: 'spoken evidence '.repeat(150) }));
  const batches = planMeaningBatches(rows, 8, 'ollama');
  assert.deepEqual(batches.flat(), rows);
  assert.ok(batches.every(batch => batch.length <= 4));
  assert.ok(batches.length > 3, 'long transcripts split before row-count limit');
  assert.equal(planMeaningBatches(rows, 8, 'openai')[0].length, 8);
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
