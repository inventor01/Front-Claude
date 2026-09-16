import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { materializeAudio, noAudioError, VideoTranscriptEngineV27 } from '../src/video-transcript-v27.mjs';

const ffmpeg = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim();

test('decoder errors and HTTP failures are not evidence of absent audio', () => {
  assert.equal(noAudioError("Stream map '0:a:0' matches no streams."), true);
  for (const error of ['could not find codec parameters for stream 0 audio', 'Invalid data found when processing input', 'no audio downloaded', 'media 403']) {
    assert.equal(noAudioError(error), false);
  }
});

test('old browser-track-only no-speech cache is retried', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-audio-cache-'));
  try {
    const engine = new VideoTranscriptEngineV27({ dataDir: dir });
    const row = { id: 'test', platform: 'X', url: 'https://x.com/test/status/123' };
    engine.cache[engine.key(row)] = { at: Date.now(), value: { transcriptStatus: 'no-speech', transcriptSource: 'browser-media-track' } };
    assert.equal(engine.cached(row), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const kind of ['audio', 'silent-video', 'invalid']) {
  test(`actual decoder distinguishes ${kind} even with zero browser capture tracks`, { skip: !ffmpeg }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-audio-test-'));
    let disposed = false;
    try {
      const media = path.join(dir, 'fixture.mp4');
      if (kind === 'invalid') fs.writeFileSync(media, 'Not a video: acquisition failed');
      else {
        const args = kind === 'audio'
          ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac']
          : ['-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.2', '-c:v', 'mpeg4', '-an'];
        const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, '-y', media]);
        assert.equal(made.status, 0, String(made.stderr));
      }
      const context = { cookies: async () => [], request: { get: async () => ({
        ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'video/mp4' }),
        body: async () => fs.readFileSync(media), dispose: async () => { disposed = true; },
      }) } };
      const result = await materializeAudio(context, {
        url: 'https://x.com/test/status/123', audioTrackCount: 0,
        candidates: [{ url: 'https://video.twimg.com/test.mp4', type: 'video/mp4', source: 'network' }],
      }, dir, ffmpeg, 5000);
      assert.equal(disposed, true);
      assert.equal(Boolean(result.wav), kind === 'audio');
      if (kind !== 'audio') assert.equal(result.noAudio, kind === 'silent-video', result.error);
      assert.equal(result.diagnostics[0].status, 200);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('a visible-caption fragment without terminal status cannot bypass transcription', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-caption-fragment-'));
  try {
    const engine = new VideoTranscriptEngineV27({ dataDir: dir });
    const result = await engine.transcribeOne({}, {
      id: 'fragment', platform: 'TikTok', url: 'https://www.tiktok.com/@creator/video/7685470299579518230',
      transcript: 'Only the currently visible sentence', transcriptSource: 'platform-visible-captions',
      mediaCandidates: [{ url: 'https://cdn.test/video.mp4', type: 'video/mp4' }],
    });
    assert.equal(result.transcriptStatus, 'unavailable', 'missing ASR must remain unavailable, not a falsely complete caption');
    assert.equal(result.transcript, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
