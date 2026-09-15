import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { captureRenderedVideoFrame } from '../src/video-meaning-v27.mjs';

const ffmpeg = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim();
test('cross-origin video canvas failure falls back to a cropped real frame', { skip: !ffmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-frame-test-'));
  let browser;
  try {
    const file = path.join(dir, 'red.mp4');
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', file]);
    assert.equal(made.status, 0, String(made.stderr));
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.route('https://post.test/**', route => route.fulfill({ contentType: 'text/html', body: '<video muted autoplay src="https://media.test/red.mp4"></video>' }));
    await page.route('https://media.test/**', route => route.fulfill({ contentType: 'video/mp4', body: fs.readFileSync(file) }));
    await page.goto('https://post.test/');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    const video = page.locator('video');
    const tainted = await video.evaluate(v => { const c = document.createElement('canvas'); c.getContext('2d').drawImage(v, 0, 0); try { c.toDataURL(); return false; } catch { return true; } });
    assert.equal(tainted, true);
    const frame = await captureRenderedVideoFrame(page, video);
    const decoded = await page.evaluate(base64 => new Promise(resolve => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const ctx = c.getContext('2d'); ctx.drawImage(i, 0, 0); resolve({ width: i.width, height: i.height, pixel: [...ctx.getImageData(i.width / 2, i.height / 2, 1, 1).data] }); }; i.src = `data:image/jpeg;base64,${base64}`; }), frame);
    assert.equal(decoded.width, 336);
    assert.equal(decoded.height, 189);
    assert.ok(decoded.pixel[0] > 200 && decoded.pixel[1] < 50 && decoded.pixel[2] < 50);
  } finally { await browser?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
