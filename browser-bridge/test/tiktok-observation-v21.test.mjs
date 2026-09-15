import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groundedTikTokEvidence,
  mergeScanEvidence,
  mergeTikTokObservations,
  mergeTranscriptFragments,
  normalizeTikTokObservation,
  parseTikTokVideoUrl,
} from '../src/tiktok-observation-v21.mjs';
import {
  isKnownTikTokFeedContainerE2E,
  isTikTokDiscoveryPage,
  isTikTokLocalActivityE2E,
  shouldDriveTikTokFeed,
} from '../src/tiktok-observer-v21.mjs';

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

test('platform spoken captions can ground an otherwise caption-light video',()=>{
  const row=normalizeTikTokObservation({href:'https://www.tiktok.com/@speaker/video/1000000000000000011',transcript:'OpenAI reconstructed a fruit fly connectome',transcriptSource:'platform-visible-captions'},123);
  assert(row);
  assert.equal(row.observedOnly,false);
  assert.equal(row.transcript,'OpenAI reconstructed a fruit fly connectome');
  assert.equal(groundedTikTokEvidence([row]).length,1);
});

test('transcript fragments accumulate across repeated observer polls',()=>{
  assert.equal(mergeTranscriptFragments('OpenAI reconstructed a fruit fly','fruit fly connectome could model a brain'),'OpenAI reconstructed a fruit fly · fruit fly connectome could model a brain');
  assert.equal(mergeTranscriptFragments('same complete sentence','same complete sentence'),'same complete sentence');
});

test('later richer DOM observation upgrades the same TikTok URL and preserves first seen', () => {
  const first = normalizeTikTokObservation({ href: 'https://www.tiktok.com/@creator/video/1000000000000000002', transcript:'first spoken line' }, 100);
  const richer = normalizeTikTokObservation({
    href: 'https://www.tiktok.com/@creator/video/1000000000000000002?lang=en',
    containerText: 'Mascot falls during halftime dance #halftime',
    transcript:'second spoken line',
    coverUrl: 'https://example.test/cover.jpg',
  }, 200);
  const [row] = mergeTikTokObservations([first], [richer]);
  assert.equal(row.firstObserved, 100);
  assert.equal(row.observedOnly, false);
  assert.match(row.content, /Mascot falls/i);
  assert.match(row.transcript,/first spoken line/);
  assert.match(row.transcript,/second spoken line/);
  assert.equal(groundedTikTokEvidence([row]).length, 1);
});

test('TikTok video URLs canonicalize away query strings and reject non-video links', () => {
  assert.deepEqual(parseTikTokVideoUrl('https://www.tiktok.com/@abc/video/1000000000000000003?is_from_webapp=1'), {
    author: 'abc', id: '1000000000000000003', url: 'https://www.tiktok.com/@abc/video/1000000000000000003',
  });
  assert.equal(parseTikTokVideoUrl('https://www.tiktok.com/explore'), null);
});

test('broad grounded TikTok rows augment final scan evidence without duplicating enriched rows', () => {
  const base = [{ id: 'tiktok:browser:1000000000000000004', platform: 'TikTok', author: 'a', url: 'https://www.tiktok.com/@a/video/1000000000000000004', content: 'caption', contentSummary: 'Visual summary', transcript:'spoken detail', firstObserved: 200 }];
  const broad = [{ id: 'tiktok:browser:1000000000000000004', platform: 'TikTok', author: 'a', url: 'https://www.tiktok.com/@a/video/1000000000000000004', content: 'longer browser text but no visual summary', transcript:'second detail', firstObserved: 100 }];
  const merged = mergeScanEvidence(base, broad);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].contentSummary, 'Visual summary');
  assert.match(merged[0].transcript,/spoken detail/);
  assert.match(merged[0].transcript,/second detail/);
  assert.equal(merged[0].firstObserved, 100);
});

test('TikTok root feed is scroll-driven after /foryou redirects to / when video cards present', () => {
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/', true), true);
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/', false), false);
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/foryou', false), true);
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/explore', false), true);
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/search?q=meme', false), true);
  assert.equal(shouldDriveTikTokFeed('https://www.tiktok.com/@creator', true), false);
});

test('TikTok discovery excludes account activity and personal surfaces', () => {
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/'), true);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/foryou'), true);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/explore'), true);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/search?q=meme'), true);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/inbox'), false);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/messages'), false);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/notification'), false);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/@creator'), false);
  assert.equal(isTikTokDiscoveryPage('https://www.tiktok.com/@creator/video/1000000000000000009'), false);
});

test('current TikTok For You feed containers are allowed even when persistent inbox chrome exists elsewhere', () => {
  assert.equal(isKnownTikTokFeedContainerE2E('recommend-list-item-container'), true);
  assert.equal(isKnownTikTokFeedContainerE2E('feed-item'), true);
  assert.equal(isKnownTikTokFeedContainerE2E('search-card'), true);
  assert.equal(isTikTokLocalActivityE2E('recommend-list-item-container'), false);
  assert.equal(isTikTokLocalActivityE2E('inbox-list-item'), true);
  assert.equal(isTikTokLocalActivityE2E('notification-item'), true);
  assert.equal(isTikTokLocalActivityE2E('user-post-item'), true);
});

test('TikTok observation rejects non-HTTP video protocols',()=>{
 assert.equal(parseTikTokVideoUrl('ftp://www.tiktok.com/@a/video/1234567890123'),null);
});
