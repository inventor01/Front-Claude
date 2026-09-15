import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSocialPostUrl } from '../src/social-post-url.mjs';
import { selectVideoCandidates } from '../src/content-understanding.mjs';
test('poisoned cache values cannot become video navigation candidates', () => {
  const bad = ['chmod +x browser-bridge/start.command', '/@alice/video/1234567890123', 'file://x.com/a/status/1', 'https://evil.com/@a/video/1234567890123', 'https://x.com/home', 'https://x.com/a/status/1/garbage', 'https://user:pass@x.com/a/status/1'];
  for (const url of bad) {
    assert.equal(canonicalSocialPostUrl(url), null, url);
    assert.deepEqual(selectVideoCandidates([{id:'poison', platform:'TikTok', url, mediaType:'video'}]), []);
  }
});
test('supported social posts canonicalize exactly and respect platform', () => {
  assert.equal(canonicalSocialPostUrl('https://twitter.com/alice/status/123/photo/1?s=20', 'X'), 'https://x.com/alice/status/123');
  assert.equal(canonicalSocialPostUrl('https://www.tiktok.com/@alice/video/1234567890123?lang=en', 'TikTok'), 'https://www.tiktok.com/@alice/video/1234567890123');
  assert.equal(canonicalSocialPostUrl('https://x.com/alice/status/123', 'TikTok'), null);
});
