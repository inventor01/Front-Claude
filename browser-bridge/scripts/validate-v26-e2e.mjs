#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { isTikTokActivityText, parseTikTokVideoUrl } from '../src/tiktok-observation-v21.mjs';
import { isTikTokDiscoveryPage } from '../src/tiktok-observer-v21.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(here, '..');
const repoRoot = path.resolve(bridgeRoot, '..');

const BRIDGE = process.env.FRONT_E2E_BRIDGE || 'http://127.0.0.1:43981';
const CDP = process.env.FRONT_E2E_CDP || 'http://127.0.0.1:43982';
const TARGET = clampInt(process.env.FRONT_E2E_TARGET, 90, 30, 180);
const MIN_X = clampInt(process.env.FRONT_E2E_MIN_X, 5, 1, TARGET);
const MIN_TIKTOK = clampInt(process.env.FRONT_E2E_MIN_TIKTOK, 5, 1, TARGET);
const MIN_TIKTOK_GROUNDED = clampInt(process.env.FRONT_E2E_MIN_TIKTOK_GROUNDED, 3, 1, TARGET);
const SCAN_TIMEOUT_MS = clampInt(process.env.FRONT_E2E_TIMEOUT_MS, 12 * 60_000, 60_000, 30 * 60_000);
const POLL_MS = clampInt(process.env.FRONT_E2E_POLL_MS, 1500, 500, 10_000);
const SKIP_STATIC = process.env.FRONT_E2E_SKIP_STATIC === '1';
const REPORT_PATH = process.env.FRONT_E2E_REPORT || path.join(os.homedir(), '.front-browser-bridge', 'validation-v26-latest.json');

const failures = [];
const warnings = [];
const passes = [];
const phaseSeen = new Set();
const stageSnapshots = new Map();
let browserForProbe = null;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function n(value) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function check(name, ok, detail = '') {
  const row = { name, ok: Boolean(ok), detail: String(detail || '') };
  if (row.ok) { passes.push(row); console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failures.push(row); console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  return row.ok;
}
function warn(name, detail = '') {
  warnings.push({ name, detail: String(detail || '') });
  console.warn(`⚠️  ${name}${detail ? ` — ${detail}` : ''}`);
}
function runCommand(label, command, args, cwd) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) {
    check(label, false, result.error.message);
    return false;
  }
  return check(label, result.status === 0, `exit ${result.status ?? 'unknown'}`);
}
async function fetchJson(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}
function sourceCount(rows, platform) {
  return rows.filter((row) => String(row?.platform || '').toLowerCase() === platform.toLowerCase()).length;
}
function creators(rows, platform) {
  return new Set(rows
    .filter((row) => !platform || String(row?.platform || '').toLowerCase() === platform.toLowerCase())
    .map((row) => String(row?.author || '').trim().toLowerCase())
    .filter(Boolean));
}
function duplicateKeys(rows) {
  const seen = new Set();
  const dupes = [];
  for (const row of rows) {
    const key = `${row?.platform || ''}|${row?.url || ''}`;
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  return dupes;
}
function xNotificationLike(value) {
  const text = String(value || '');
  return /\b(?:liked your post|reposted your post|followed you|mentioned you|replied to your post|sent you a message)\b/i.test(text);
}
function exactXPostUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname) && /^\/[^/]+\/status\/\d+/.test(url.pathname);
  } catch { return false; }
}
function summarizeStage(stage = {}) {
  return `${stage.status || 'missing'}${stage.observed != null ? ` observed=${stage.observed}` : ''}${stage.grounded != null ? ` grounded=${stage.grounded}` : ''}`;
}
async function probeSocialDom(context) {
  console.log('\n▶ Authenticated browser DOM probes');
  const xPage = await context.newPage();
  const tPage = await context.newPage();
  try {
    await xPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await xPage.waitForTimeout(3500);
    const xProbe = await xPage.evaluate(() => ({
      url: location.href,
      tweets: document.querySelectorAll('article[data-testid="tweet"]').length,
      loginForm: Boolean(document.querySelector('input[autocomplete="username"], input[name="text"]')) && /sign in|log in/i.test(document.body?.innerText || ''),
    })).catch(() => ({ url: xPage.url(), tweets: 0, loginForm: false }));
    check('X opens the authenticated home surface', /(^|\.)x\.com$/i.test(new URL(xProbe.url).hostname) && /\/home(?:\/|$)/.test(new URL(xProbe.url).pathname), xProbe.url);
    if (xProbe.loginForm) check('X is not showing a login wall', false, 'login UI detected');
    else check('X is not showing a login wall', true, `${xProbe.tweets} visible tweet article(s) during probe`);

    await tPage.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await tPage.waitForTimeout(3500);
    for (let i = 0; i < 2; i++) {
      await tPage.evaluate(() => window.scrollBy(0, Math.max(innerHeight * 0.9, 760))).catch(() => {});
      await tPage.waitForTimeout(1200);
    }
    const tProbe = await tPage.evaluate(() => {
      const feedSelector = [
        '[data-e2e*="recommend-list-item-container"]',
        '[data-e2e*="recommend-item"]',
        '[data-e2e*="feed-item"]',
        '[data-e2e*="search-card"]',
        'article',
      ].join(', ');
      const activitySelector = [
        '[data-e2e*="inbox"]',
        '[data-e2e*="notification"]',
        '[data-e2e*="activity"]',
        '[data-e2e*="message"]',
        '[role="dialog"]',
      ].join(', ');
      const anchors = [...document.querySelectorAll('a[href*="/video/"]')];
      const eligible = anchors.filter((link) => {
        if (link.closest(activitySelector)) return false;
        const container = link.closest(feedSelector);
        if (!container || container.closest(activitySelector)) return false;
        const e2e = String(container.getAttribute('data-e2e') || '').toLowerCase();
        if (/user-post-item|profile|inbox|notification|activity|message/.test(e2e)) return false;
        return true;
      });
      const body = document.body?.innerText || '';
      return {
        url: location.href,
        rawVideoAnchors: anchors.length,
        eligibleVideoAnchors: eligible.length,
        knownFeedContainers: document.querySelectorAll(feedSelector).length,
        activityContainers: document.querySelectorAll(activitySelector).length,
        loginLikely: /\blog in\b|\bsign up\b/i.test(body) && anchors.length === 0,
        challengeLikely: /captcha|verify to continue|security check|unusual traffic|confirm you are human/i.test(body),
      };
    });
    check('TikTok stays on a discovery surface', isTikTokDiscoveryPage(tProbe.url), tProbe.url);
    check('TikTok renders video anchors', tProbe.rawVideoAnchors > 0, `raw=${tProbe.rawVideoAnchors}, feedContainers=${tProbe.knownFeedContainers}`);
    check('TikTok strict feed filter admits video anchors', tProbe.eligibleVideoAnchors > 0, `eligible=${tProbe.eligibleVideoAnchors}, raw=${tProbe.rawVideoAnchors}`);
    check('TikTok is not showing a security challenge', !tProbe.challengeLikely, tProbe.challengeLikely ? 'challenge text detected' : 'none detected');
    if (tProbe.loginLikely) check('TikTok is not showing a login wall', false, 'login/signup surface detected with zero video anchors');
    else check('TikTok is not showing a login wall', true);
    return { x: xProbe, tiktok: tProbe };
  } finally {
    await xPage.close().catch(() => {});
    await tPage.close().catch(() => {});
  }
}
async function monitorScan(expectedScanIdRef) {
  let lastSignature = '';
  let finalLive = null;
  const started = Date.now();
  while (Date.now() - started < SCAN_TIMEOUT_MS) {
    await sleep(POLL_MS);
    let live;
    try {
      ({ body: live } = await fetchJson(`${BRIDGE}/live`, {}, 5000));
    } catch (error) {
      warn('Live monitor request failed', error?.message || error);
      continue;
    }
    if (!live || live.ok === false) continue;
    if (live.scanId && !expectedScanIdRef.value) expectedScanIdRef.value = live.scanId;
    if (expectedScanIdRef.value && live.scanId !== expectedScanIdRef.value) continue;
    if (live.phase) phaseSeen.add(live.phase);
    for (const [name, value] of Object.entries(live.stages || {})) stageSnapshots.set(name, value);
    const t = live.tiktokDiscovery || {};
    const x = live.stages?.xDiscovery || {};
    const signature = [live.status, live.phase, x.status, x.observed, t.status, t.observed, t.grounded, live.candidateTopics].join('|');
    if (signature !== lastSignature) {
      lastSignature = signature;
      console.log(`   ${live.status || '?'} · ${live.phase || '?'} · X ${x.observed || 0} · TikTok ${t.observed || 0}/${t.grounded || 0} grounded · topics ${live.candidateTopics || 0}`);
    }
    if (expectedScanIdRef.value && live.active === false && ['complete', 'zero', 'failed', 'stopped'].includes(live.status)) {
      finalLive = live;
      break;
    }
  }
  return finalLive;
}
async function main() {
  console.log('FRONT v26 RELEASE-GATE E2E VALIDATOR');
  console.log(`Bridge: ${BRIDGE}`);
  console.log(`Chrome CDP: ${CDP}`);
  console.log(`Target: ${TARGET} per requested feed · minimum X=${MIN_X}, TikTok=${MIN_TIKTOK}, grounded TikTok=${MIN_TIKTOK_GROUNDED}`);

  console.log('\n▶ Preflight');
  let health;
  try {
    const result = await fetchJson(`${BRIDGE}/health`, {}, 7000);
    health = result.body;
    check('Bridge responds', result.response.ok && health?.ok === true, `${result.response.status}`);
  } catch (error) {
    check('Bridge responds', false, error?.message || error);
    throw new Error('Start browser-bridge/start.command before running this validator.');
  }
  check('v26 single-process runtime is active', health?.version === 26 && health?.architecture === 'single-process', `version=${health?.version}, architecture=${health?.architecture}`);
  check('Validator will not collide with another scan', !health?.running, health?.running ? `scan ${health?.scanId || 'unknown'} is already running` : 'idle');
  check('Content understanding is enabled', health?.contentUnderstanding?.enabled === true, `${health?.contentUnderstanding?.provider || 'off'} · ${health?.contentUnderstanding?.model || 'no model'}`);
  check('Context/post understanding is enabled', health?.postUnderstanding?.enabled === true, `${health?.postUnderstanding?.provider || 'off'} · ${health?.postUnderstanding?.model || 'no model'}`);
  check('Bridge owns the expected ports only', n(health?.activePorts?.bridge) === 43981 && n(health?.activePorts?.chromeCdp) === 43982, JSON.stringify(health?.activePorts || {}));
  if (failures.length) throw new Error('Preflight failed.');

  if (!SKIP_STATIC) {
    if (!runCommand('Browser-bridge regression suite', 'npm', ['test'], bridgeRoot)) throw new Error('Regression suite failed.');
    if (!runCommand('Production application build', 'npm', ['run', 'build'], repoRoot)) throw new Error('Production build failed.');
  } else {
    warn('Static QA skipped', 'FRONT_E2E_SKIP_STATIC=1');
  }

  console.log('\n▶ Chrome CDP attach');
  const versionResult = await fetchJson(`${CDP}/json/version`, {}, 7000);
  check('Chrome DevTools endpoint responds', versionResult.response.ok && Boolean(versionResult.body?.webSocketDebuggerUrl), versionResult.body?.Browser || `${versionResult.response.status}`);
  browserForProbe = await chromium.connectOverCDP(CDP, { noDefaults: true, timeout: 15_000 });
  const context = browserForProbe.contexts()[0];
  check('Playwright attaches to the existing Front Chrome', Boolean(context), `${browserForProbe.contexts().length} context(s)`);
  if (!context) throw new Error('Chrome did not expose a browser context.');
  await probeSocialDom(context);
  if (failures.length) throw new Error('Authenticated browser DOM probe failed.');

  console.log('\n▶ Fresh authenticated deep scan');
  const scanAbort = new AbortController();
  const scanTimer = setTimeout(() => scanAbort.abort(), SCAN_TIMEOUT_MS);
  const scanIdRef = { value: null };
  const scanPromise = fetch(`${BRIDGE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'deep', targetUniqueFeedItems: TARGET, scanXForYou: true, scanTikTokForYou: true }),
    signal: scanAbort.signal,
  }).then(async (response) => {
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (body?.scanId && !scanIdRef.value) scanIdRef.value = body.scanId;
    return { response, body };
  });

  const livePromise = monitorScan(scanIdRef);
  let scanResult;
  let finalLive;
  try {
    [scanResult, finalLive] = await Promise.all([scanPromise, livePromise]);
  } finally {
    clearTimeout(scanTimer);
  }

  check('Scan HTTP request succeeds', scanResult.response.ok, `${scanResult.response.status}`);
  check('Scan returns ok=true', scanResult.body?.ok === true, scanResult.body?.error || 'ok');
  const evidence = Array.isArray(scanResult.body?.evidence) ? scanResult.body.evidence : [];
  const topics = Array.isArray(scanResult.body?.inferredTopics) ? scanResult.body.inferredTopics : [];
  check('Scan produces canonical evidence', evidence.length > 0, `${evidence.length} row(s)`);
  check('Scan finishes cleanly', finalLive?.status === 'complete' && finalLive?.phase === 'complete', `${finalLive?.status || 'missing'} / ${finalLive?.phase || 'missing'}`);
  check('Scan reports no pipeline errors', Array.isArray(finalLive?.errors) && finalLive.errors.length === 0, `${finalLive?.errors?.length || 0} error(s)`);

  const stages = finalLive?.stages || scanResult.body?.audit?.stages || Object.fromEntries(stageSnapshots);
  const tSnap = finalLive?.tiktokDiscovery || {};
  const xStage = stages.xDiscovery || {};
  const tStage = stages.tiktokDiscovery || {};
  const vision = stages.visualUnderstanding || {};
  const post = stages.postUnderstanding || {};
  const narrative = stages.narrativeEngine || {};
  const origin = stages.originResearch || {};

  check('Chrome preflight stage connects', stages.chrome?.status === 'connected', summarizeStage(stages.chrome));
  check('X discovery completes', xStage.status === 'complete', summarizeStage(xStage));
  check(`X discovers at least ${MIN_X} posts`, n(xStage.observed) >= MIN_X, `observed=${n(xStage.observed)}`);
  check('TikTok discovery completes', tStage.status === 'complete', summarizeStage(tStage));
  check(`TikTok observes at least ${MIN_TIKTOK} videos`, Math.max(n(tStage.observed), n(tSnap.observed)) >= MIN_TIKTOK, `observed=${Math.max(n(tStage.observed), n(tSnap.observed))}`);
  check(`TikTok grounds at least ${MIN_TIKTOK_GROUNDED} videos`, Math.max(n(tStage.grounded), n(tSnap.grounded)) >= MIN_TIKTOK_GROUNDED, `grounded=${Math.max(n(tStage.grounded), n(tSnap.grounded))}`);
  const tikTokPages = [...new Set([...(Array.isArray(tStage.sourcePages) ? tStage.sourcePages : []), ...(Array.isArray(tSnap.sourcePages) ? tSnap.sourcePages : [])])];
  check('TikTok discovery stays off personal/activity surfaces', tikTokPages.length > 0 && tikTokPages.every(isTikTokDiscoveryPage), tikTokPages.join(', ') || 'no source page');

  check('Visual understanding stage completes', vision.status === 'complete', `${vision.status || 'missing'} · requested=${n(vision.requested)} analyzed=${n(vision.analyzed)} cached=${n(vision.cached)} enriched=${n(vision.enriched)} failed=${n(vision.failed)}`);
  check('Visual understanding actually exercises video analysis', n(vision.requested) > 0 && (n(vision.enriched) + n(vision.cached)) > 0, `requested=${n(vision.requested)}, enriched=${n(vision.enriched)}, cached=${n(vision.cached)}`);
  check('Visual understanding has zero failures', n(vision.failed) === 0, `failed=${n(vision.failed)}`);
  check('Post understanding stage completes', post.status === 'complete', `${post.status || 'missing'} · total=${n(post.total)} cached=${n(post.cached)} modeled=${n(post.modeled)} fallback=${n(post.fallback)} failed=${n(post.failed)}`);
  check('Semantic post understanding is actually used', (n(post.modeled) + n(post.cached)) > 0, `modeled=${n(post.modeled)}, cached=${n(post.cached)}`);
  check('Post understanding has zero model failures', n(post.failed) === 0, `failed=${n(post.failed)}`);
  check('Narrative engine completes', narrative.status === 'complete', `${n(narrative.candidates)} candidate narrative(s)`);
  check('Origin research completes', origin.status === 'complete', `${n(origin.searched)} search(es)`);

  const xEvidence = evidence.filter((row) => String(row?.platform || '').toLowerCase() === 'x');
  const tEvidence = evidence.filter((row) => String(row?.platform || '').toLowerCase() === 'tiktok');
  check(`Final evidence retains at least ${MIN_X} X posts`, xEvidence.length >= MIN_X, `${xEvidence.length}`);
  check(`Final evidence retains at least ${MIN_TIKTOK_GROUNDED} grounded TikTok posts`, tEvidence.length >= MIN_TIKTOK_GROUNDED, `${tEvidence.length}`);
  check('X evidence uses canonical post URLs', xEvidence.every((row) => exactXPostUrl(row?.url)), `${xEvidence.filter((row) => !exactXPostUrl(row?.url)).length} invalid URL(s)`);
  check('X notification chrome is absent from evidence', xEvidence.every((row) => !xNotificationLike(row?.content) && !xNotificationLike(row?.contentSummary)), `${xEvidence.filter((row) => xNotificationLike(row?.content) || xNotificationLike(row?.contentSummary)).length} violation(s)`);
  check('Every TikTok evidence row is a canonical video URL', tEvidence.every((row) => Boolean(parseTikTokVideoUrl(row?.url))), `${tEvidence.filter((row) => !parseTikTokVideoUrl(row?.url)).length} invalid URL(s)`);
  check('TikTok activity/notification text is absent', tEvidence.every((row) => !isTikTokActivityText(row?.content) && !isTikTokActivityText(row?.contentSummary)), `${tEvidence.filter((row) => isTikTokActivityText(row?.content) || isTikTokActivityText(row?.contentSummary)).length} violation(s)`);
  check('Evidence has no duplicate platform+URL rows', duplicateKeys(evidence).length === 0, `${duplicateKeys(evidence).length} duplicate(s)`);
  check('X evidence spans at least two creators', creators(xEvidence).size >= 2, `${creators(xEvidence).size} creator(s)`);
  check('TikTok evidence spans at least two creators', creators(tEvidence).size >= 2, `${creators(tEvidence).size} creator(s)`);
  check('At least one video has visual understanding attached', evidence.some((row) => Boolean(row?.contentSummary) && n(row?.contentConfidence) >= 0.5), `${evidence.filter((row) => Boolean(row?.contentSummary)).length} visually summarized row(s)`);
  check('At least one post has semantic-model understanding', evidence.some((row) => row?.postUnderstandingMethod === 'semantic-model' && n(row?.postUnderstandingConfidence) >= 0.5), `${evidence.filter((row) => row?.postUnderstandingMethod === 'semantic-model').length} semantic row(s)`);

  console.log('\n▶ Persistent health + ledger agreement');
  const afterHealth = (await fetchJson(`${BRIDGE}/health`, {}, 7000)).body;
  check('Content understanding remains healthy after scan', ['healthy', 'cached-ready'].includes(afterHealth?.contentUnderstanding?.state), `${afterHealth?.contentUnderstanding?.state || 'missing'} · successfulCachedVideos=${n(afterHealth?.contentUnderstanding?.successfulCachedVideos)} · failedCachedVideos=${n(afterHealth?.contentUnderstanding?.failedCachedVideos)}`);
  check('A successful visual analysis is persisted', n(afterHealth?.contentUnderstanding?.successfulCachedVideos) > 0 && Boolean(afterHealth?.contentUnderstanding?.latestSuccess), `${n(afterHealth?.contentUnderstanding?.successfulCachedVideos)} successful cache entr${n(afterHealth?.contentUnderstanding?.successfulCachedVideos) === 1 ? 'y' : 'ies'}`);
  check('No malformed URL poison returned to the content cache', !/chmod\s+\+x|failed to parse url/i.test(String(afterHealth?.contentUnderstanding?.latestFailure?.error || '')), afterHealth?.contentUnderstanding?.latestFailure?.error || 'clean');

  const ledger = (await fetchJson(`${BRIDGE}/ledger`, {}, 7000)).body;
  const ledgerEntry = Array.isArray(ledger?.scans) ? ledger.scans.find((row) => row?.id === scanIdRef.value) : null;
  check('Finished scan is persisted in the ledger', Boolean(ledgerEntry), scanIdRef.value || 'no scan id');
  if (ledgerEntry) {
    check('Ledger status matches the final scan', ledgerEntry.status === finalLive?.status, `ledger=${ledgerEntry.status}, live=${finalLive?.status}`);
    check('Ledger observed count matches final canonical evidence', n(ledgerEntry.observed) === evidence.length, `ledger=${n(ledgerEntry.observed)}, evidence=${evidence.length}`);
    check('Ledger narrative count matches final response', n(ledgerEntry.candidateTopics) === topics.length, `ledger=${n(ledgerEntry.candidateTopics)}, response=${topics.length}`);
  }

  check('The scan reached discovery', phaseSeen.has('discovery'), [...phaseSeen].join(' → '));
  check('The scan reached visual understanding', phaseSeen.has('visual-understanding'), [...phaseSeen].join(' → '));
  check('The scan reached narrative ranking', phaseSeen.has('narrative-ranking'), [...phaseSeen].join(' → '));

  const report = {
    at: new Date().toISOString(),
    ok: failures.length === 0,
    bridge: BRIDGE,
    cdp: CDP,
    target: TARGET,
    scanId: scanIdRef.value,
    counts: {
      evidence: evidence.length,
      xEvidence: xEvidence.length,
      tiktokEvidence: tEvidence.length,
      xCreators: creators(xEvidence).size,
      tiktokCreators: creators(tEvidence).size,
      narratives: topics.length,
    },
    phases: [...phaseSeen],
    passes,
    warnings,
    failures,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n════════════════════════════════════════════════════════');
  console.log(failures.length ? `❌ FRONT v26 RELEASE GATE FAILED (${failures.length} failure${failures.length === 1 ? '' : 's'})` : '✅ FRONT v26 RELEASE GATE PASSED');
  console.log(`Evidence: ${evidence.length} · X: ${xEvidence.length} · TikTok: ${tEvidence.length} · narratives: ${topics.length}`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log('════════════════════════════════════════════════════════');
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  if (!failures.some((row) => row.detail === String(error?.message || error))) check('Validator completed without an unhandled failure', false, error?.message || error);
  const report = {
    at: new Date().toISOString(),
    ok: false,
    bridge: BRIDGE,
    cdp: CDP,
    passes,
    warnings,
    failures,
    fatal: String(error?.stack || error?.message || error),
  };
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch {}
  console.error(`\n❌ FRONT v26 RELEASE GATE FAILED\n${error?.stack || error}`);
  console.error(`Report: ${REPORT_PATH}`);
  process.exitCode = 1;
});
