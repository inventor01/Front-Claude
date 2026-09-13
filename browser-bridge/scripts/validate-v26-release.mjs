#!/usr/bin/env node

import { nativeLoopbackScan } from '../src/loopback-scan-fetch-compat.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { isTikTokActivityText, parseTikTokVideoUrl } from '../src/tiktok-observation-v21.mjs';
import { isTikTokDiscoveryPage, extractTikTokAnchors } from '../src/tiktok-observer-v21.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(here, '..');
const repoRoot = path.resolve(bridgeRoot, '..');
const BRIDGE = process.env.FRONT_E2E_BRIDGE || 'http://127.0.0.1:43981';
const CDP = process.env.FRONT_E2E_CDP || 'http://127.0.0.1:43982';
const TARGET = Math.max(30, Math.min(180, Number(process.env.FRONT_E2E_TARGET || 90)));
const TIMEOUT_MS = Math.max(120000, Number(process.env.FRONT_E2E_TIMEOUT_MS || 720000));
const REPORT = process.env.FRONT_E2E_REPORT || path.join(os.homedir(), '.front-browser-bridge', 'validation-v26-latest.json');
const SKIP_STATIC = process.env.FRONT_E2E_SKIP_STATIC === '1';

const failures = [];
const passes = [];
const warnings = [];
const phases = new Set();

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  const row = { name, ok: Boolean(ok), detail: String(detail || '') };
  (row.ok ? passes : failures).push(row);
  console[row.ok ? 'log' : 'error'](`${row.ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return row.ok;
}
function warn(name, detail = '') {
  warnings.push({ name, detail: String(detail || '') });
  console.warn(`⚠️  ${name}${detail ? ` — ${detail}` : ''}`);
}
function run(label, command, args, cwd) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  return check(label, !r.error && r.status === 0, r.error?.message || `exit ${r.status}`);
}
async function json(url, options = {}, timeout = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal, cache: 'no-store' });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { res, body };
  } finally { clearTimeout(timer); }
}
function canonicalX(value) {
  try {
    const u = new URL(value);
    return /(^|\.)(x\.com|twitter\.com)$/i.test(u.hostname) && /^\/[^/]+\/status\/\d+/.test(u.pathname);
  } catch { return false; }
}
function xActivity(value) {
  return /\b(?:liked your post|reposted your post|followed you|mentioned you|replied to your post|sent you a message)\b/i.test(String(value || ''));
}
function creators(rows) {
  return new Set(rows.map((r) => String(r?.author || '').trim().toLowerCase()).filter(Boolean));
}
function duplicates(rows) {
  const seen = new Set();
  let count = 0;
  for (const row of rows) {
    const key = `${row?.platform || ''}|${row?.url || ''}`;
    if (seen.has(key)) count++;
    seen.add(key);
  }
  return count;
}

async function probe(context) {
  console.log('\n▶ Authenticated browser probes');
  const x = await context.newPage();
  const t = await context.newPage();
  try {
    await x.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await x.locator('article[data-testid="tweet"]').first().waitFor({timeout:20000});
    const xp = await x.evaluate(() => ({
      url: location.href,
      tweets: document.querySelectorAll('article[data-testid="tweet"]').length,
      login: Boolean(document.querySelector('input[autocomplete="username"],input[name="text"]')) && /sign in|log in/i.test(document.body?.innerText || ''),
    }));
    check('X authenticated home surface', /\/home(?:\/|$)/.test(new URL(xp.url).pathname) && !xp.login, `${xp.url} · ${xp.tweets} tweet article(s)`);

    await t.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let extracted;
    const readyUntil = Date.now() + 20000;
    do {
      extracted = await extractTikTokAnchors(t, 'release probe');
      if (extracted.observations.length) break;
      await sleep(500);
    } while (Date.now() < readyUntil);

    const tp = await t.evaluate(() => {
      const feedSelector = [
        '[data-e2e*="recommend-list-item-container"]',
        '[data-e2e*="recommend-item"]',
        '[data-e2e*="feed-item"]',
        '[data-e2e*="search-card"]',
        'article',
      ].join(', ');
      const localActivitySelector = [
        '[data-e2e="inbox-list-item"]',
        '[data-e2e*="notification-item"]',
        '[data-e2e*="activity-item"]',
        '[data-e2e*="message-item"]',
        '[data-e2e*="user-post-item"]',
        '[role="dialog"]',
      ].join(', ');
      const anchors = [...document.querySelectorAll('a[href*="/video/"]')];
      const eligible = anchors.filter((link) => {
        const container = link.closest(feedSelector);
        if (!container) return false;
        if (link.closest(localActivitySelector) || container.closest(localActivitySelector)) return false;
        const e2e = String(container.getAttribute('data-e2e') || '').toLowerCase();
        if (/user-post-item|profile|inbox-list-item|notification-item|activity-item|message-item/.test(e2e)) return false;
        const text = container.innerText || '';
        if (/\b(?:liked your video|liked your post|commented on your video|replied to your comment|shared your video|reposted your video|viewed your profile|mentioned you|tagged you|followed you|sent you a message)\b/i.test(text)) return false;
        return true;
      });
      const body = document.body?.innerText || '';
      return {
        url: location.href,
        anchors: anchors.length,
        eligible: eligible.length,
        containers: document.querySelectorAll(feedSelector).length,
        login: /\blog in\b|\bsign up\b/i.test(body) && anchors.length === 0,
        challenge: /captcha|verify to continue|security check|unusual traffic|confirm you are human/i.test(body),
      };
    });
    check('TikTok discovery surface', isTikTokDiscoveryPage(tp.url), tp.url);
    check('TikTok renders real video identities', extracted.observations.length > 0, `anchors=${tp.anchors}, playerCards=${extracted.diagnostics.playerCardsAccepted || 0}, feedContainers=${tp.containers}`);
    check('TikTok feed filter admits current For You cards', extracted.observations.length > 0, JSON.stringify(extracted.diagnostics));
    check('TikTok not login-walled', !tp.login, tp.login ? 'login/signup wall' : 'ok');
    check('TikTok not challenged', !tp.challenge, tp.challenge ? 'challenge detected' : 'ok');
    return { x: xp, tiktok: tp };
  } finally {
    await x.close().catch(() => {});
    await t.close().catch(() => {});
  }
}

async function monitor(scanIdRef) {
  const start = Date.now();
  let final = null;
  let last = '';
  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(1500);
    let live;
    try { live = (await json(`${BRIDGE}/live`, {}, 5000)).body; }
    catch (e) { warn('Live poll failed', e?.message || e); continue; }
    if (!live) continue;
    if (live.scanId && !scanIdRef.value) scanIdRef.value = live.scanId;
    if (scanIdRef.value && live.scanId !== scanIdRef.value) continue;
    if (live.phase) phases.add(live.phase);
    for (const transition of live.phaseHistory || []) phases.add(transition.phase);
    const x = live.stages?.xDiscovery || {};
    const t = live.tiktokDiscovery || {};
    const sig = [live.status, live.phase, x.observed, t.observed, t.grounded, live.candidateTopics].join('|');
    if (sig !== last) {
      last = sig;
      console.log(`   ${live.status || '?'} · ${live.phase || '?'} · X=${n(x.observed)} · TikTok=${n(t.observed)}/${n(t.grounded)} grounded · topics=${n(live.candidateTopics)}`);
    }
    if (scanIdRef.value && live.active === false && ['complete','failed','stopped','zero'].includes(live.status)) { final = live; break; }
  }
  return final;
}

async function main() {
  console.log('FRONT v26 RELEASE GATE');
  console.log(`Bridge ${BRIDGE} · CDP ${CDP}`);

  const health = (await json(`${BRIDGE}/health`, {}, 7000)).body;
  check('Bridge healthy', health?.ok === true && health?.version === 26, `version=${health?.version}`);
  check('No scan already running', !health?.running, health?.scanId || 'idle');
  check('Visual understanding configured', health?.contentUnderstanding?.enabled === true, `${health?.contentUnderstanding?.provider || 'off'} · ${health?.contentUnderstanding?.model || ''}`);
  check('Post understanding configured', health?.postUnderstanding?.enabled === true, `${health?.postUnderstanding?.provider || 'off'} · ${health?.postUnderstanding?.model || ''}`);
  if (failures.length) throw new Error('Preflight failed');

  if (!SKIP_STATIC) {
    if (!run('Browser bridge tests', 'npm', ['test'], bridgeRoot)) throw new Error('Tests failed');
    if (!run('Production build', 'npm', ['run','build'], repoRoot)) throw new Error('Build failed');
  }

  const meta = await json(`${CDP}/json/version`, {}, 7000);
  check('Chrome CDP reachable', meta.res.ok && Boolean(meta.body?.webSocketDebuggerUrl), meta.body?.Browser || String(meta.res.status));
  const browser = await chromium.connectOverCDP(CDP, { noDefaults: true, timeout: 15000 });
  const context = browser.contexts()[0];
  check('Playwright attaches to existing Front Chrome', Boolean(context), `${browser.contexts().length} context(s)`);
  if (!context) throw new Error('No Chrome context');
  await probe(context);
  if (failures.length) throw new Error('Browser probe failed');

  console.log('\n▶ Fresh deep scan');
  const scanIdRef = { value: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const scanPromise = nativeLoopbackScan(`${BRIDGE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode:'deep', targetUniqueFeedItems:TARGET, scanXForYou:true, scanTikTokForYou:true }),
    signal: ctl.signal,
  }).then(async (res) => {
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw:text }; }
    if (body?.scanId && !scanIdRef.value) scanIdRef.value = body.scanId;
    return { res, body };
  });
  let scan, live;
  try { [scan, live] = await Promise.all([scanPromise, monitor(scanIdRef)]); }
  finally { clearTimeout(timer); }

  fs.mkdirSync(path.dirname(REPORT), { recursive:true });
  fs.writeFileSync(REPORT.replace(/\.json$/, '') + '-scan.json', JSON.stringify({scan:scan?.body, live}, null, 2));

  check('Scan request succeeds', scan?.res?.ok === true, `${scan?.res?.status || 'no response'} ${scan?.body?.error || ''}`);
  check('Scan returns ok=true', scan?.body?.ok === true, scan?.body?.error || 'ok');
  check('Scan reaches complete state', live?.status === 'complete' && live?.phase === 'complete', `${live?.status || 'missing'} / ${live?.phase || 'missing'}`);
  check('No pipeline errors', Array.isArray(live?.errors) && live.errors.length === 0, `${live?.errors?.length || 0} error(s)`);

  const evidence = Array.isArray(scan?.body?.evidence) ? scan.body.evidence : [];
  const topics = Array.isArray(scan?.body?.inferredTopics) ? scan.body.inferredTopics : [];
  const stages = live?.stages || scan?.body?.audit?.stages || {};
  const xs = stages.xDiscovery || {};
  const ts = stages.tiktokDiscovery || {};
  const tLive = live?.tiktokDiscovery || {};
  const vision = stages.visualUnderstanding || {};
  const post = stages.postUnderstanding || {};
  const narrative = stages.narrativeEngine || {};
  const origin = stages.originResearch || {};

  check('Chrome stage connected', stages.chrome?.status === 'connected', stages.chrome?.status || 'missing');
  check('X discovery complete', xs.status === 'complete', `${xs.status || 'missing'} observed=${n(xs.observed)}`);
  check('X collected real posts', n(xs.observed) >= 5, `observed=${n(xs.observed)}`);
  check('TikTok discovery complete', ts.status === 'complete', `${ts.status || 'missing'} observed=${n(ts.observed)} grounded=${n(ts.grounded)}`);
  check('TikTok collected real videos', Math.max(n(ts.observed), n(tLive.observed)) >= 5, `observed=${Math.max(n(ts.observed), n(tLive.observed))}`);
  check('TikTok produced grounded evidence', Math.max(n(ts.grounded), n(tLive.grounded)) >= 3, `grounded=${Math.max(n(ts.grounded), n(tLive.grounded))}`);
  check('TikTok source pages remain discovery-only', [...new Set([...(ts.sourcePages || []), ...(tLive.sourcePages || [])])].every(isTikTokDiscoveryPage), [...new Set([...(ts.sourcePages || []), ...(tLive.sourcePages || [])])].join(', '));

  check('Visual understanding complete', vision.status === 'complete', `${vision.status || 'missing'} requested=${n(vision.requested)} enriched=${n(vision.enriched)} cached=${n(vision.cached)} failed=${n(vision.failed)}`);
  check('Qwen/video understanding actually exercised', n(vision.requested) > 0 && (n(vision.enriched) + n(vision.cached)) > 0, `requested=${n(vision.requested)}, enriched=${n(vision.enriched)}, cached=${n(vision.cached)}`);
  check('Visual understanding has zero failures', n(vision.failed) === 0, `failed=${n(vision.failed)}`);
  check('Post understanding complete', post.status === 'complete', `${post.status || 'missing'} modeled=${n(post.modeled)} cached=${n(post.cached)} failed=${n(post.failed)}`);
  check('Semantic post understanding used', n(post.modeled) + n(post.cached) > 0, `modeled=${n(post.modeled)}, cached=${n(post.cached)}`);
  check('Post understanding has zero failures', n(post.failed) === 0, `failed=${n(post.failed)}`);
  check('Narrative engine complete', narrative.status === 'complete', `candidates=${n(narrative.candidates)}`);
  check('Origin research complete', origin.status === 'complete', `searched=${n(origin.searched)}`);

  const xRows = evidence.filter((r) => String(r?.platform).toLowerCase() === 'x');
  const tRows = evidence.filter((r) => String(r?.platform).toLowerCase() === 'tiktok');
  check('Final evidence contains X', xRows.length >= 5, `${xRows.length}`);
  check('Final evidence contains TikTok', tRows.length >= 3, `${tRows.length}`);
  check('All X rows use canonical status URLs', xRows.every((r) => canonicalX(r.url)), `${xRows.filter((r) => !canonicalX(r.url)).length} invalid`);
  check('No X notification leakage', xRows.every((r) => !xActivity(r.content) && !xActivity(r.contentSummary)), `${xRows.filter((r) => xActivity(r.content) || xActivity(r.contentSummary)).length} violations`);
  check('All TikTok rows use canonical video URLs', tRows.every((r) => Boolean(parseTikTokVideoUrl(r.url))), `${tRows.filter((r) => !parseTikTokVideoUrl(r.url)).length} invalid`);
  check('No TikTok activity/notification leakage', tRows.every((r) => !isTikTokActivityText(r.content) && !isTikTokActivityText(r.contentSummary)), `${tRows.filter((r) => isTikTokActivityText(r.content) || isTikTokActivityText(r.contentSummary)).length} violations`);
  check('No duplicate platform+URL rows', duplicates(evidence) === 0, `${duplicates(evidence)} duplicate(s)`);
  check('X has creator diversity', creators(xRows).size >= 2, `${creators(xRows).size} creators`);
  check('TikTok has creator diversity', creators(tRows).size >= 2, `${creators(tRows).size} creators`);
  check('At least one visual summary exists', evidence.some((r) => r.contentSummary && n(r.contentConfidence) >= .5), `${evidence.filter((r) => r.contentSummary).length} summarized rows`);
  check('At least one semantic-model frame exists', evidence.some((r) => r.postUnderstandingMethod === 'semantic-model' && n(r.postUnderstandingConfidence) >= .5), `${evidence.filter((r) => r.postUnderstandingMethod === 'semantic-model').length} semantic rows`);

  const after = (await json(`${BRIDGE}/health`, {}, 7000)).body;
  check('Content understanding remains healthy', ['healthy','cached-ready'].includes(after?.contentUnderstanding?.state), after?.contentUnderstanding?.state || 'missing');
  check('Successful visual analysis persisted', n(after?.contentUnderstanding?.successfulCachedVideos) > 0, `${n(after?.contentUnderstanding?.successfulCachedVideos)} cached successes`);
  check('Malformed URL poison absent', !/chmod\s+\+x|failed to parse url/i.test(String(after?.contentUnderstanding?.latestFailure?.error || '')), after?.contentUnderstanding?.latestFailure?.error || 'clean');

  const ledger = (await json(`${BRIDGE}/ledger`, {}, 7000)).body;
  const row = Array.isArray(ledger?.scans) ? ledger.scans.find((r) => r?.id === scanIdRef.value) : null;
  check('Finished scan persisted to ledger', Boolean(row), scanIdRef.value || 'missing scan id');
  if (row) {
    check('Ledger status agrees with live result', row.status === live?.status, `ledger=${row.status}, live=${live?.status}`);
    check('Ledger observed agrees with response', n(row.observed) === evidence.length, `ledger=${n(row.observed)}, evidence=${evidence.length}`);
    check('Ledger topic count agrees with response', n(row.candidateTopics) === topics.length, `ledger=${n(row.candidateTopics)}, response=${topics.length}`);
  }

  check('Discovery phase observed', phases.has('discovery'), [...phases].join(' → '));
  check('Visual-understanding phase observed', phases.has('visual-understanding'), [...phases].join(' → '));
  check('Narrative-ranking phase observed', phases.has('narrative-ranking'), [...phases].join(' → '));

  const report = {
    at: new Date().toISOString(), ok: failures.length === 0, scanId: scanIdRef.value,
    counts: { evidence:evidence.length, x:xRows.length, tiktok:tRows.length, narratives:topics.length },
    phases:[...phases], passes, warnings, failures,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive:true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log('\n════════════════════════════════════════════════════════');
  console.log(failures.length ? `❌ FRONT v26 RELEASE GATE FAILED (${failures.length})` : '✅ FRONT v26 RELEASE GATE PASSED');
  console.log(`Evidence ${evidence.length} · X ${xRows.length} · TikTok ${tRows.length} · narratives ${topics.length}`);
  console.log(`Report: ${REPORT}`);
  console.log('════════════════════════════════════════════════════════');
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  check('Validator completed without fatal error', false, error?.message || error);
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive:true });
    fs.writeFileSync(REPORT, JSON.stringify({ at:new Date().toISOString(), ok:false, passes, warnings, failures, fatal:String(error?.stack || error) }, null, 2));
  } catch {}
  console.error(`\n❌ FRONT v26 RELEASE GATE FAILED\n${error?.stack || error}`);
  process.exitCode = 1;
}).finally(() => {
  // End only this CLI process; never close the authenticated CDP browser.
  process.exit(process.exitCode || 0);
});
