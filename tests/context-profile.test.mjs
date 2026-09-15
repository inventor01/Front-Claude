import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const env=fs.readFileSync(new URL('../browser-bridge/content.env',import.meta.url),'utf8');
const example=fs.readFileSync(new URL('../browser-bridge/content.env.example',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../browser-bridge/src/post-understanding-v26.mjs',import.meta.url),'utf8');

test('8GB semantic profile stays on compact batches and output budgets',()=>{
  assert.match(env,/FRONT_CONTEXT_BATCH_SIZE=2/);
  assert.match(env,/FRONT_CONTEXT_NUM_PREDICT=400/);
  assert.match(example,/FRONT_CONTEXT_BATCH_SIZE=2/);
  assert.match(example,/FRONT_CONTEXT_NUM_PREDICT=400/);
  assert.match(engine,/Math\.min\(2, Number\(batchSize\)/);
  assert.match(engine,/Math\.min\(400, Number\(process\.env\.FRONT_CONTEXT_NUM_PREDICT/);
});
