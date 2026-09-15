#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN_FREE_GB = Math.max(1, Number(process.env.FRONT_MIN_FREE_DISK_GB || 3));
const DATA_DIR = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const MIN_FREE_BYTES = MIN_FREE_GB * 1024 ** 3;

function nearestExisting(start) {
  let current = path.resolve(start);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return os.homedir();
    current = parent;
  }
  return current;
}

function freeBytes(target) {
  const stats = fs.statfsSync(nearestExisting(target));
  return Number(stats.bavail) * Number(stats.bsize);
}

function gb(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function cleanupAbandonedTranscriptTemps() {
  if (!fs.existsSync(DATA_DIR)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.startsWith('transcript-tmp-')) continue;
    const target = path.join(DATA_DIR, name);
    try {
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) continue;
      // Only clean stale temp work; active jobs are younger than 6 hours.
      if (Date.now() - stat.mtimeMs < 6 * 60 * 60 * 1000) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}

const removed = cleanupAbandonedTranscriptTemps();
const free = freeBytes(DATA_DIR);
console.log(`Front v27 disk preflight: ${gb(free)} GB free${removed ? ` · removed ${removed} stale transcript temp dir(s)` : ''}.`);

if (free < MIN_FREE_BYTES) {
  console.error(`Front v27 requires at least ${MIN_FREE_GB.toFixed(1)} GB free before a full authenticated transcript gate.`);
  console.error('Free disk space first. This prevents ffmpeg/Whisper/Chrome/Ollama failures from being misdiagnosed as scanner bugs.');
  process.exit(2);
}

console.log('Front v27 disk preflight passed.');
