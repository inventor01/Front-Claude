import test from 'node:test';
import assert from 'node:assert/strict';
import { isVideoRow, normalizeTranscript, selectMediaCandidates, transcriptTerminal } from '../src/video-transcript-v27.mjs';
import { enrichVideoMeaning, mapWithConcurrency, meaningInput, needsVisualFallback, normalizeMeaningTranscript, reusableVideoMeaning } from '../src/video-meaning-v27.mjs';

test('v27 identifies every TikTok and X video as transcript eligible', () => {
  assert.equal(isVideoRow({ platform: 'TikTok', mediaType: 'video' }), true);
  assert.equal(isVideoRow({ platform: 'TikTok' }), true);
  assert.equal(isVideoRow({ platform: 'X', mediaType: 'video' }), true);
  assert.equal(isVideoRow({ platform: 'X', mediaType: 'image' }), false);
});

test('transcript terminal states only accept actual completion', () => {
  for (const status of ['captioned', 'transcribed', 'no-speech']) assert.equal(transcriptTerminal(status), true);
  for (const status of ['failed', 'unavailable', 'pending', '']) assert.equal(transcriptTerminal(status), false);
});

test('transcript normalization removes non-speech markers but preserves words', () => {
  assert.equal(normalizeTranscript('  Hello   [Music] world. [APPLAUSE]  '), 'Hello world.');
});

test('media selection prefers real video/audio media over images and blob URLs', () => {
  const rows = selectMediaCandidates([
    { url: 'blob:https://x.com/abc', type: 'video/mp4' },
    { url: 'https://pbs.twimg.com/poster.jpg', type: 'image/jpeg' },
    { url: 'https://video.twimg.com/a/master.m3u8', type: 'application/x-mpegURL' },
    { url: 'https://video.twimg.com/a/video.mp4', type: 'video/mp4' },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].url, /video\.mp4|master\.m3u8/);
  assert.ok(rows.every((row) => /^https:/.test(row.url)));
});

test('video meaning treats transcript + caption as first-class evidence', () => {
  const row = { platform: 'TikTok', content: 'A creator explains a new sneaker drop', transcript: 'The red pair releases Friday morning.' };
  const input = meaningInput(row);
  assert.match(input.combined, /sneaker drop/);
  assert.match(input.combined, /releases Friday/);
  assert.equal(needsVisualFallback(row), false);
});

test('video meaning removes X timing markup while preserving spoken words', () => {
  const raw = '<123-Hello-ms> <00:01.234> <456-world-ms> [Music] <789-again-ms>';
  assert.equal(normalizeMeaningTranscript(raw), 'Hello world again');
  const input = meaningInput({ platform:'X', content:'caption', transcript:raw });
  assert.equal(input.spoken, 'Hello world again');
  assert.doesNotMatch(input.combined, /123|456|789|ms|00:01/);
});

test('bounded meaning work never exceeds the configured concurrency', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('X HLS fragments cannot crowd the complete playlist out of acquisition', () => {
  const playlist = { url: 'https://video.twimg.com/example/master.m3u8', type: 'application/x-mpegURL' };
  const fragments = Array.from({ length: 20 }, (_, i) => ({
    url: `https://video.twimg.com/example/${i}.m4s?tag=1`, type: 'video/mp4',
  }));
  const selected = selectMediaCandidates([...fragments, playlist]);
  assert.deepEqual(selected.map(item => item.url), [playlist.url]);
  const initialization = { url: 'https://video.twimg.com/amplify_video/123/aud/mp4a/0/0/32000/init.mp4', type: 'video/mp4' };
  assert.deepEqual(selectMediaCandidates([initialization, playlist]).map(item => item.url), [playlist.url]);
});

test('TikTok CDN application assets cannot crowd out extensionless video', () => {
  const assets = Array.from({ length: 20 }, (_, i) => ({
    url: `https://lf16-tiktok-web.tiktokcdn-us.com/static/chunk-${i}.js`, type: '',
  }));
  const media = { url: 'https://v16.tiktokcdn.com/video/tos/useast/clip', type: 'video/mp4' };
  const selected = selectMediaCandidates([...assets,
    { url: 'https://lf16.tiktokcdn.com/asset', type: 'application/javascript' },
    { url: 'https://lf16.tiktokcdn.com/cover', type: 'image/avif' }, media]);
  assert.deepEqual(selected.map(item => item.url), [media.url]);
});

test('low-information silent videos require visual fallback', () => {
  assert.equal(needsVisualFallback({ platform:'TikTok', content:'wow', transcript:'', transcriptStatus:'no-speech' }), true);
});

test('failed or weak video meanings are never reusable cache hits', () => {
  assert.equal(reusableVideoMeaning({ videoMeaningStatus:'failed', videoAbout:'fallback caption', videoMeaningConfidence:.9 }), false);
  assert.equal(reusableVideoMeaning({ videoMeaningStatus:'modeled', videoAbout:'specific event', videoMeaningConfidence:.39 }), false);
  assert.equal(reusableVideoMeaning({ videoMeaningStatus:'modeled', videoAbout:'specific event', videoMeaningConfidence:.8 }), true);
});

test('meaning enrichment preserves raw caption and makes modeled meaning clusterable', () => {
  const enriched = enrichVideoMeaning(
    { id:'1', platform:'X', mediaType:'video', content:'Original caption', transcript:'Spoken words here' },
    { videoAbout:'A driver reacts to a delivery app pay change', videoSubject:'delivery app pay', videoEvent:'driver reacts to pay change', videoMeaningConfidence:.91, videoMeaningMethod:'semantic-model', videoMeaningStatus:'modeled' },
  );
  assert.equal(enriched.sourceContent, 'Original caption');
  assert.match(enriched.content, /Video meaning: A driver reacts/);
  assert.match(enriched.content, /Spoken transcript: Spoken words here/);
  assert.equal(enriched.videoMeaningStatus, 'modeled');
  assert.equal(enriched.videoMeaningConfidence, .91);
});
