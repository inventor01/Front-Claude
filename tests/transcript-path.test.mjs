import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const observer=fs.readFileSync(new URL('../browser-bridge/src/tiktok-observer-v21.mjs',import.meta.url),'utf8');
const understanding=fs.readFileSync(new URL('../browser-bridge/src/post-understanding-v26.mjs',import.meta.url),'utf8');

test('TikTok transcript path is opportunistic and feeds semantic understanding separately from caption',()=>{
  assert.match(observer,/platform-visible-captions/);
  assert.match(observer,/textTracks/);
  assert.match(observer,/activeCues/);
  assert.match(understanding,/spoken: clean\(row\.transcript/);
  assert.match(understanding,/transcriptSource/);
  assert.match(understanding,/grounded-v4-structured/);
});
