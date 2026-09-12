import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groundedTikTokEvidence,
  mergeScanEvidence,
  mergeTikTokObservations,
  normalizeTikTokObservation,
  parseTikTokVideoUrl,
} from '../src/tiktok-observation-v21.mjs';

test('TikTok observer has no four-video ceiling and retains broad unique discovery', () => {
  const rows = Array.from({ length: 90 }, (_, index) => normalizeTikTokObservation({
    href: `https://www.tiktok.com/@creator${index}/video/${1000000000000000000n + BigInt(index)}`,
    containerText: index % 3 ? `viral clip ${index} #moment` : '',
  }, 1000 + index));
  const merged = mergeTikTokObservations([], rows);
  assert.equal(merged.length, 90);
  assert(merged.length > 4);
});

test('caption-light video is observed without being falsely promoted as grounded evidence', () => {
  const row = normalizeTikTokObservation({ href: 'https://www.tiktok.com/@quiet/video/1000000000000000001' }, 123);
  assert(row);
  assert.equal(row.observedOnly, true);
  assert.equal(groundedTikTokEvidence([row]).length, 0);
});

test('later richer DOM observation upgrades the same TikTok URL and preserves first seen', () => {
  const first = normalizeTikTokObservation({ href: 'https://www.tiktok.com/@creator/video/1000000000000000002' }, 100);
  const richer = normalizeTikTokObservation({
    href: 'https://www.tiktok.com/@creator/video/1000000000000000002?lang=en',
    containerText: 'Mascot falls during halftime dance #halftime',
    coverUrl: 'https://example.test/cover.jpg',
  }, 200);
  const [row] = mergeTikTokObservations([first], [richer]);
  assert.equal(row.firstObserved, 100);
  assert.equal(row.observedOnly, false);
  assert.match(row.content, /Mascot falls/i);
  assert.equal(groundedTikTokEvidence([row]).length, 1);
});

test('TikTok video URLs canonicalize away query strings and reject non-video links', () => {
  assert.deepEqual(parseTikTokVideoUrl('https://www.tiktok.com/@abc/video/1000000000000000003?is_from_webapp=1'), {
    author: 'abc', id: '1000000000000000003', url: 'https://www.tiktok.com/@abc/video/1000000000000000003',
  });
  assert.equal(parseTikTokVideoUrl('https://www.tiktok.com/explore'), null);
});

test('broad grounded TikTok rows augment final scan evidence without duplicating enriched rows', () => {
  const base = [{ id: 'tiktok:browser:1000000000000000004', platform: 'TikTok', author: 'a', url: 'https://www.tiktok.com/@a/video/1000000000000000004', content: 'caption', contentSummary: 'Visual summary', firstObserved: 200 }];
  const broad = [{ id: 'tiktok:browser:1000000000000000004', platform: 'TikTok', author: 'a', url: 'https://www.tiktok.com/@a/video/1000000000000000004', content: 'longer browser text but no visual summary', firstObserved: 100 }];
  const merged = mergeScanEvidence(base, broad);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].contentSummary, 'Visual summary');
  assert.equal(merged[0].firstObserved, 100);
});
