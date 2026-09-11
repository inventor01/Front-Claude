import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHashtags, extractTikTokItemsFromJson, xTrendLabel } from '../src/core.mjs';

// These fixtures deliberately resemble only the stable data shapes the collector
// depends on. They catch regressions in extraction without making CI depend on
// live X/TikTok pages, login state, or anti-abuse systems.
test('scanner helpers recover an X trend and TikTok video evidence from fixture data', () => {
  const xCard = 'Trending in United States\n#DejonLove\n18.2K posts';
  assert.equal(xTrendLabel(xCard), '#DejonLove');

  const tiktokState = {
    ItemModule: {
      '7361234567890123456': {
        id: '7361234567890123456',
        desc: 'Dejon Love reaction is everywhere #DejonLove',
        author: { uniqueId: 'fixturecreator' },
        createTime: 1789100000,
        stats: { playCount: 1250000, diggCount: 99000 },
      },
    },
  };
  const videos = extractTikTokItemsFromJson(tiktokState);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].author, 'fixturecreator');
  assert.equal(videos[0].views, 1250000);
  assert.deepEqual(extractHashtags(videos[0].content), ['DejonLove']);
});
