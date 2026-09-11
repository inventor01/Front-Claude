import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CDP_PORT, frontCdpUrl, frontLoginProfileDir, openRegularChromeForLogin } from '../src/system-browser.mjs';

test('builds a dedicated local Chrome profile path', () => {
  const dataDir = path.join(os.tmpdir(), 'front-browser-test');
  assert.equal(frontLoginProfileDir(dataDir), path.join(dataDir, 'chrome-profile'));
});

test('builds a loopback-only DevTools endpoint', () => {
  assert.equal(frontCdpUrl(), `http://127.0.0.1:${DEFAULT_CDP_PORT}`);
  assert.equal(frontCdpUrl(45555), 'http://127.0.0.1:45555');
});

test('opens regular Chrome with Front profile, local DevTools, and both login pages', () => {
  const calls = [];
  const fakeChild = { unref() { calls.push({ unref: true }); } };
  const spawnImpl = (exe, args, options) => {
    calls.push({ exe, args, options });
    return fakeChild;
  };
  const dataDir = path.join(os.tmpdir(), `front-browser-${Date.now()}`);
  const result = openRegularChromeForLogin({
    dataDir,
    chromeExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    debuggingPort: 45555,
    spawnImpl,
  });
  assert.equal(result.profileDir, path.join(dataDir, 'chrome-profile'));
  assert.equal(result.cdpUrl, 'http://127.0.0.1:45555');
  assert.equal(calls[0].exe, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(calls[0].args.some((arg) => arg.startsWith('--user-data-dir=')));
  assert.ok(calls[0].args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(calls[0].args.includes('--remote-debugging-port=45555'));
  assert.ok(calls[0].args.includes('https://x.com/home'));
  assert.ok(calls[0].args.includes('https://www.tiktok.com/'));
  assert.equal(calls[0].options.detached, true);
});

test('fails clearly when Chrome is unavailable', () => {
  assert.throws(() => openRegularChromeForLogin({ dataDir: os.tmpdir(), chromeExecutable: null }), /Google Chrome was not found/);
});
