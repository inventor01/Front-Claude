import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldObserveTikTokLivePreview } from '../src/live-observer-v20.mjs';

test('standalone v20 can preview TikTok, but v21 child port disables duplicate TikTok observation', () => {
  assert.equal(shouldObserveTikTokLivePreview(43981), true);
  assert.equal(shouldObserveTikTokLivePreview('43981'), true);
  assert.equal(shouldObserveTikTokLivePreview(43986), false);
  assert.equal(shouldObserveTikTokLivePreview('43986'), false);
});
