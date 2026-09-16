import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript, preferLocalAsrForRow } from '../src/video-transcript-v27.mjs';

test('v32 strips X-word-ms timing markup while preserving spoken words', () => {
  const raw = '<X-word-ms ms=120,159,260,80,141,580 index=1 character_ranges=0-1,2-6,7-12,13-15,16-18,19-24>My hair today is so fried</X-word-ms> <X-word-ms ms=20,120,99,139,540 index=2 character_ranges=0-0,1-6,7-11,12-16,17-25>I don\'t know what happened</X-word-ms>';
  const normalized = normalizeTranscript(raw);
  assert.equal(normalized, "My hair today is so fried I don't know what happened");
  assert.doesNotMatch(normalized, /X-word-ms|character_ranges|index=|\bms=/i);
});

test('v32 removes WebVTT formatting/timestamps and decodes caption entities', () => {
  const raw = '<00:01.234><v Speaker><c.yellow>Hello &amp; welcome</c></v> [Music] <ruby>today<rt>annotation</rt></ruby>';
  assert.equal(normalizeTranscript(raw), 'Hello & welcome today annotation');
});

test('v32 prefers local Whisper for X when authenticated media is available', () => {
  const inspected = { transcript: 'native caption', candidates: [{ url: 'https://video.twimg.com/a/video.mp4' }] };
  assert.equal(preferLocalAsrForRow({ platform: 'X' }, inspected, true), true);
  assert.equal(preferLocalAsrForRow({ platform: 'TikTok' }, inspected, true), false);
  assert.equal(preferLocalAsrForRow({ platform: 'X' }, { ...inspected, candidates: [] }, true), false);
  assert.equal(preferLocalAsrForRow({ platform: 'X' }, inspected, false), false);
});
