import test from 'node:test';
import assert from 'node:assert/strict';
import { isVideoRow, normalizeTranscript, selectMediaCandidates, transcriptTerminal } from '../src/video-transcript-v27.mjs';
import { enrichVideoMeaning, meaningInput, needsVisualFallback } from '../src/video-meaning-v27.mjs';

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

test('low-information silent videos require visual fallback', () => {
  assert.equal(needsVisualFallback({ platform:'TikTok', content:'wow', transcript:'', transcriptStatus:'no-speech' }), true);
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
