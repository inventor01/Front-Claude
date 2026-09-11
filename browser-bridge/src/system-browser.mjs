import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const DEFAULT_CDP_PORT = 43982;

export function findSystemChrome(platform = process.platform, env = process.env) {
  const candidates = [];
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    );
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  } else if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]) {
      if (root) candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function frontLoginProfileDir(dataDir) {
  return path.join(dataDir, 'chrome-profile');
}

export function frontCdpUrl(port = DEFAULT_CDP_PORT) {
  return `http://127.0.0.1:${port}`;
}

export function stopExistingFrontChrome({ dataDir, platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  const profileDir = frontLoginProfileDir(dataDir);
  if (platform === 'darwin' || platform === 'linux') {
    const result = spawnSyncImpl('pkill', ['-TERM', '-f', profileDir], { stdio: 'ignore' });
    return result?.status === 0;
  }
  return false;
}

export async function waitForCdp(cdpUrl, { timeoutMs = 10000, intervalMs = 200, fetchImpl = fetch } = {}) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchImpl(`${cdpUrl}/json/version`, { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.webSocketDebuggerUrl) return payload;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Chrome DevTools did not become ready at ${cdpUrl}${lastError ? ` (${lastError})` : ''}.`);
}

export function openRegularChromeForLogin({
  dataDir,
  chromeExecutable = findSystemChrome(),
  debuggingPort = DEFAULT_CDP_PORT,
  spawnImpl = spawn,
} = {}) {
  if (!chromeExecutable) {
    throw new Error('Google Chrome was not found. Install Chrome or open X/TikTok in your normal browser manually.');
  }
  const profileDir = frontLoginProfileDir(dataDir);
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawnImpl(chromeExecutable, [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--new-window',
    'https://x.com/home',
    'https://www.tiktok.com/',
  ], { detached: true, stdio: 'ignore' });
  child.unref?.();
  return { chromeExecutable, profileDir, debuggingPort, cdpUrl: frontCdpUrl(debuggingPort) };
}
