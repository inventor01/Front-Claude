import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalSocialPostUrl } from './social-post-url.mjs';

export const VIDEO_TRANSCRIPT_VERSION = 27;
const CACHE_TTL_MS = 7 * 24 * 3600000;
const MAX_TRANSCRIPT_CHARS = 24000;
const DEFAULT_TIMEOUT_MS = Math.max(45000, Number(process.env.FRONT_TRANSCRIPT_TIMEOUT_MS || 180000));

const clean = (value, max = MAX_TRANSCRIPT_CHARS) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

function findCommand(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}
function executable(value) {
  try { return Boolean(value) && fs.existsSync(value) && Boolean(fs.statSync(value).mode & 0o111); } catch { return false; }
}
export function isVideoRow(row) {
  return row?.platform === 'TikTok' || /video/i.test(String(row?.mediaType || ''));
}
export function transcriptTerminal(status) {
  return ['captioned', 'transcribed', 'no-speech'].includes(String(status || ''));
}
export function normalizeTranscript(value) {
  return clean(String(value || '')
    .replace(/\[(?:music|applause|laughter|silence|inaudible)\]/gi, ' ')
    .replace(/\s+/g, ' '), MAX_TRANSCRIPT_CHARS);
}
export function mediaCandidateScore(item) {
  const url = String(item?.url || '');
  const type = String(item?.type || '').toLowerCase();
  let score = 0;
  if (/video\/mp4|audio\/mp4/.test(type)) score += 50;
  if (/mpegurl|m3u8/.test(type) || /\.m3u8(?:\?|$)/i.test(url)) score += 45;
  if (/\.mp4(?:\?|$)/i.test(url)) score += 40;
  if (/video\.twimg\.com|tiktokcdn|byteoversea|muscdn|ibytedtos/i.test(url)) score += 25;
  if (/blob:|data:/i.test(url)) score -= 100;
  if (/poster|thumbnail|image|\.jpe?g|\.png|\.webp/i.test(url)) score -= 100;
  return score;
}
export function selectMediaCandidates(items = [], limit = 10) {
  const seen = new Set();
  return items
    .filter((item) => item?.url && /^https?:/i.test(String(item.url)))
    .filter((item) => { const key = String(item.url); if (seen.has(key)) return false; seen.add(key); return true; })
    .map((item) => ({ ...item, score: mediaCandidateScore(item) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function run(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1500).unref(); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, code: null, stdout, stderr, timedOut, error }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut, error: null }); });
  });
}

async function inspectPost(context, row, timeoutMs) {
  const url = canonicalSocialPostUrl(row?.url, row?.platform);
  if (!url) throw new Error('Unsupported or malformed social post URL');
  const page = await context.newPage();
  const network = [];
  page.on('response', (response) => {
    try {
      const headers = response.headers();
      const type = String(headers['content-type'] || '');
      const candidateUrl = response.url();
      if (/^(?:video|audio)\//i.test(type) || /mpegurl/i.test(type) || /\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(candidateUrl) || /video\.twimg\.com|tiktokcdn|byteoversea|muscdn|ibytedtos/i.test(candidateUrl)) {
        network.push({ url: candidateUrl, type, source: 'network' });
      }
    } catch {}
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(30000, timeoutMs) });
    await page.locator('video').first().waitFor({ state: 'attached', timeout: Math.min(15000, timeoutMs) }).catch(() => {});
    const video = page.locator('video').first();
    if (!(await video.count().catch(() => 0))) return { url, transcript: '', duration: 0, candidates: selectMediaCandidates(network) };
    const info = await video.evaluate(async (element) => {
      try {
        element.muted = true;
        await element.play().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 350));
        element.pause();
      } catch {}
      for (const track of Array.from(element.textTracks || [])) { try { track.mode = 'hidden'; } catch {} }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const lines = [];
      for (const track of Array.from(element.textTracks || [])) {
        for (const cue of Array.from(track.cues || [])) if (cue && typeof cue.text === 'string') lines.push(cue.text);
      }
      const sources = [element.currentSrc, element.src, ...Array.from(element.querySelectorAll('source')).map((source) => source.src)]
        .filter(Boolean).map((source) => ({ url: source, type: '', source: 'video-element' }));
      const resources = performance.getEntriesByType('resource').map((entry) => ({ url: entry.name, type: '', source: 'performance' }));
      return {
        transcript: [...new Set(lines)].join(' '),
        duration: Number.isFinite(element.duration) ? element.duration : 0,
        sources,
        resources,
      };
    }).catch(() => ({ transcript: '', duration: 0, sources: [], resources: [] }));
    return {
      url,
      transcript: normalizeTranscript(info.transcript),
      duration: Number(info.duration || 0),
      candidates: selectMediaCandidates([...(info.sources || []), ...network, ...(info.resources || [])]),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function materializeAudio(context, inspected, tempDir, ffmpegBin, timeoutMs) {
  const wav = path.join(tempDir, 'audio.wav');
  let lastError = '';
  for (let index = 0; index < inspected.candidates.length; index++) {
    const candidate = inspected.candidates[index];
    let input = candidate.url;
    let localMedia = '';
    const hls = /mpegurl/i.test(String(candidate.type || '')) || /\.m3u8(?:\?|$)/i.test(candidate.url);
    if (!hls) {
      try {
        const response = await context.request.get(candidate.url, {
          headers: { Referer: inspected.url },
          timeout: Math.min(timeoutMs, 60000),
          failOnStatusCode: false,
        });
        if (response.ok()) {
          const body = await response.body();
          if (body.length > 0 && body.length <= 150 * 1024 * 1024) {
            localMedia = path.join(tempDir, `media-${index}.bin`);
            fs.writeFileSync(localMedia, body);
            input = localMedia;
          }
        }
      } catch {}
    }
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
    if (!localMedia) args.push('-headers', `Referer: ${inspected.url}\r\n`);
    args.push('-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav);
    const result = await run(ffmpegBin, args, { timeoutMs });
    if (result.ok && fs.existsSync(wav) && fs.statSync(wav).size > 1000) return { wav, source: candidate.source || 'media', candidate: candidate.url };
    lastError = clean(result.stderr || result.error?.message || `ffmpeg exit ${result.code}`, 500);
    try { fs.rmSync(wav, { force: true }); } catch {}
  }
  const noAudio = /does not contain any stream|matches no streams|stream map.*matches no streams|audio.*not found/i.test(lastError);
  return { wav: null, noAudio, error: lastError || 'No usable media source could be converted to audio.' };
}

async function whisper(wav, { whisperBin, modelPath, tempDir, timeoutMs }) {
  const prefix = path.join(tempDir, 'transcript');
  const result = await run(whisperBin, ['-m', modelPath, '-f', wav, '-l', 'auto', '-nt', '-otxt', '-of', prefix], { timeoutMs });
  if (!result.ok) throw new Error(result.timedOut ? 'Local Whisper transcription timed out.' : clean(result.stderr || result.error?.message || `whisper exit ${result.code}`, 500));
  let text = '';
  try { text = fs.readFileSync(`${prefix}.txt`, 'utf8'); } catch { text = result.stdout; }
  return normalizeTranscript(text);
}

export class VideoTranscriptEngineV27 {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.cachePath = path.join(dataDir, 'video-transcripts-v27.json');
    this.cache = readJson(this.cachePath, {});
    this.whisperBin = process.env.FRONT_WHISPER_BIN || findCommand('whisper-cli');
    this.ffmpegBin = process.env.FRONT_FFMPEG_BIN || findCommand('ffmpeg');
    this.modelPath = process.env.FRONT_WHISPER_MODEL || path.join(dataDir, 'models', 'ggml-base.bin');
    this.concurrency = Math.max(1, Math.min(4, Number(process.env.FRONT_TRANSCRIPT_CONCURRENCY || 2)));
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.lastStats = null;
  }
  status() {
    const whisperReady = executable(this.whisperBin);
    const ffmpegReady = executable(this.ffmpegBin);
    const modelReady = fs.existsSync(this.modelPath);
    return {
      version: VIDEO_TRANSCRIPT_VERSION,
      enabled: true,
      provider: 'whisper.cpp',
      fullSpeechToText: whisperReady && ffmpegReady && modelReady,
      whisperReady,
      ffmpegReady,
      modelReady,
      modelPath: modelReady ? this.modelPath : null,
      concurrency: this.concurrency,
      timeoutMs: this.timeoutMs,
      cachedVideos: Object.keys(this.cache).length,
      lastStats: this.lastStats,
    };
  }
  key(row) {
    return createHash('sha256').update(JSON.stringify([row.platform, row.id, row.url, VIDEO_TRANSCRIPT_VERSION])).digest('hex');
  }
  cached(row) {
    const entry = this.cache[this.key(row)];
    if (!entry || Date.now() - Number(entry.at || 0) > CACHE_TTL_MS) return null;
    return entry.value || null;
  }
  persist() {
    this.cache = Object.fromEntries(Object.entries(this.cache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 2500));
    writeJson(this.cachePath, this.cache);
  }
  async transcribeOne(context, row) {
    const existing = normalizeTranscript(row.transcript);
    if (existing && transcriptTerminal(row.transcriptStatus || 'captioned')) return { transcript: existing, transcriptSource: row.transcriptSource || 'existing', transcriptStatus: row.transcriptStatus || 'captioned', transcriptDuration: Number(row.transcriptDuration || 0), transcriptAt: Number(row.transcriptAt || Date.now()), cached: true };
    const cached = this.cached(row);
    if (cached) return { ...cached, cached: true };
    const inspected = await inspectPost(context, row, this.timeoutMs);
    let value;
    if (inspected.transcript) {
      value = { transcript: inspected.transcript, transcriptSource: 'native-caption-track', transcriptStatus: 'captioned', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now() };
    } else if (!this.status().fullSpeechToText) {
      value = { transcript: '', transcriptSource: null, transcriptStatus: 'unavailable', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now(), transcriptError: 'Local ASR is not configured. Run browser-bridge/setup-transcription.command.' };
    } else if (!inspected.candidates.length) {
      value = { transcript: '', transcriptSource: null, transcriptStatus: 'failed', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now(), transcriptError: 'Video media source was not discoverable from the authenticated post.' };
    } else {
      const tempDir = fs.mkdtempSync(path.join(this.dataDir, 'transcript-tmp-'));
      try {
        const audio = await materializeAudio(context, inspected, tempDir, this.ffmpegBin, this.timeoutMs);
        if (!audio.wav) {
          value = audio.noAudio
            ? { transcript: '', transcriptSource: 'media-audio', transcriptStatus: 'no-speech', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now() }
            : { transcript: '', transcriptSource: null, transcriptStatus: 'failed', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now(), transcriptError: audio.error };
        } else {
          const text = await whisper(audio.wav, { whisperBin: this.whisperBin, modelPath: this.modelPath, tempDir, timeoutMs: this.timeoutMs });
          value = text
            ? { transcript: text, transcriptSource: 'whisper-local', transcriptStatus: 'transcribed', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now() }
            : { transcript: '', transcriptSource: 'whisper-local', transcriptStatus: 'no-speech', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now() };
        }
      } catch (error) {
        value = { transcript: '', transcriptSource: null, transcriptStatus: 'failed', transcriptDuration: inspected.duration || 0, transcriptAt: Date.now(), transcriptError: clean(error?.message || error, 500) };
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }
    this.cache[this.key(row)] = { at: Date.now(), value };
    this.persist();
    return { ...value, cached: false };
  }
  async enrich(context, rows = [], { concurrency = this.concurrency, onRow } = {}) {
    const startedAt = Date.now();
    const videos = rows.filter(isVideoRow);
    const output = new Map(rows.map((row) => [row.id, row]));
    const stats = { requested: videos.length, completed: 0, captioned: 0, transcribed: 0, noSpeech: 0, cached: 0, failed: 0, unavailable: 0, errors: [] };
    let cursor = 0;
    const worker = async () => {
      while (cursor < videos.length) {
        const row = videos[cursor++];
        let result;
        try { result = await this.transcribeOne(context, row); }
        catch (error) { result = { transcript: '', transcriptSource: null, transcriptStatus: 'failed', transcriptAt: Date.now(), transcriptError: clean(error?.message || error, 500), cached: false }; }
        const enriched = { ...row, ...result };
        delete enriched.cached;
        output.set(row.id, enriched);
        if (result.cached) stats.cached++;
        if (result.transcriptStatus === 'captioned') stats.captioned++;
        else if (result.transcriptStatus === 'transcribed') stats.transcribed++;
        else if (result.transcriptStatus === 'no-speech') stats.noSpeech++;
        else if (result.transcriptStatus === 'unavailable') stats.unavailable++;
        else stats.failed++;
        if (transcriptTerminal(result.transcriptStatus)) stats.completed++;
        if (result.transcriptError) stats.errors.push(`${row.id}: ${clean(result.transcriptError, 220)}`);
        if (onRow) await onRow(enriched, { ...stats, errors: [...stats.errors] });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 1, videos.length || 1)) }, () => worker()));
    stats.elapsedMs = Date.now() - startedAt;
    stats.status = stats.failed || stats.unavailable ? 'degraded' : 'complete';
    stats.errors = [...new Set(stats.errors)].slice(0, 20);
    this.lastStats = stats;
    return { rows: rows.map((row) => output.get(row.id) || row), stats };
  }
}
