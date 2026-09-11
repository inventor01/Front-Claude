import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

export function openRegularChromeForLogin({ dataDir, chromeExecutable = findSystemChrome(), spawnImpl = spawn } = {}) {
  if (!chromeExecutable) {
    throw new Error('Google Chrome was not found. Install Chrome or open X/TikTok in your normal browser manually.');
  }
  const profileDir = frontLoginProfileDir(dataDir);
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawnImpl(chromeExecutable, [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://x.com/home',
    'https://www.tiktok.com/',
  ], { detached: true, stdio: 'ignore' });
  child.unref?.();
  return { chromeExecutable, profileDir };
}
