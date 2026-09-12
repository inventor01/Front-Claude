import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { detectTopics } from './topic-engine.mjs';
import { attachSoundSignals, consolidateTopicAliases } from './adaptive-intelligence.mjs';
import { attachVisualSignals, semanticConsolidateTopics } from './advanced-intelligence.mjs';
import { frontCdpUrl } from './system-browser.mjs';
import { ContentUnderstandingEngine } from './content-understanding.mjs';
import { collectFallbackEvidence } from './fallback-discovery-v18.mjs';

const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const cdpPort = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const detector = new ContentUnderstandingEngine({ dataDir });
const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function sanitizeAnalysisPrefixes(value) {
  return String(value || '')
    .replace(/\bVisual summary:\s*/gi, '')
    .replace(/\bEvent:\s*/gi, '')
    .replace(/\bEntities:\s*/gi, '')
    .replace(/\bActions:\s*/gi, '')
    .replace(/\bOn-screen text:\s*/gi, '')
    .replace(/\bVisual motifs:\s*/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function deriveFallbackTopics(evidence = [], at = Date.now()) {
  const sanitized = evidence.map((row) => ({ ...row, content: sanitizeAnalysisPrefixes(row.content) }));
  let topics = detectTopics(sanitized, at, 24);
  topics = attachSoundSignals(topics, sanitized);
  topics = attachVisualSignals(topics, sanitized, at);
  topics = semanticConsolidateTopics(topics, sanitized, at);
  topics = consolidateTopicAliases(topics);
  return topics.filter((topic) => {
    const ids = new Set(topic.evidenceIds || []);
    const supported = evidence.filter((row) => ids.has(row.id) && row.contentSummary && Number(row.contentConfidence || 0) >= 0.5);
    const creators = new Set(supported.map((row) => `${row.platform}:${String(row.author || '').toLowerCase()}`));
    return supported.length >= 2 && creators.size >= 2;
  });
}

async function main() {
  let input = {};
  try { input = JSON.parse(process.env.FRONT_V18_FALLBACK_REQUEST || '{}'); }
  catch { throw new Error('Invalid v18 fallback request.'); }
  const scanBody = input.scanBody && typeof input.scanBody === 'object' ? input.scanBody : {};
  const target = Math.max(16, Math.min(40, Math.round(Number(scanBody.targetUniqueFeedItems || 60) / 2)));
  const passes = Math.max(2, Math.min(6, Number(scanBody.maxAdaptiveScrolls || 5)));
  const browser = await chromium.connectOverCDP(frontCdpUrl(cdpPort));
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Front Chrome did not expose a browser context for fallback discovery.');
    const discovered = await collectFallbackEvidence(context, { targetPerPlatform: target, scrollPasses: passes });
    const mode = scanBody.mode === 'scout' ? 'scout' : 'deep';
    let rows = discovered.evidence;
    let stats = { requested: 0, analyzed: 0, cached: 0, enriched: 0, failed: 0, skipped: 0, provider: detector.status().provider, model: detector.status().model };

    if (rows.length && detector.status().enabled) {
      const enrichment = await detector.enrich(context, rows, {
        mode,
        maxVideos: mode === 'deep' ? Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 4) : Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 2),
      });
      rows = enrichment.rows;
      stats = enrichment.stats;
    }

    // Empty-caption video rows are intentionally allowed into local visual
    // understanding, but never leave the Mac until a grounded summary gives
    // them real semantic content that the cloud evidence validator can accept.
    const evidence = rows.filter((row) => clean(row.content, 8000).length >= 3);
    const inferredTopics = detector.status().enabled ? deriveFallbackTopics(evidence, Date.now()) : [];
    const diagnostics = discovered.diagnostics || {};
    const errors = [...discovered.errors];
    if (!evidence.length) {
      errors.push(`v18 fallback observed X=${diagnostics.x?.collected || 0} post(s), TikTok=${diagnostics.tiktok?.collected || 0} video(s). No grounded evidence survived; verify the dedicated Front Chrome is signed in and visibly shows X/TikTok posts.`);
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      evidence,
      inferredTopics,
      errors,
      audit: {
        version: 18,
        triggered: true,
        reason: 'inner-scanner-returned-zero-evidence',
        rawEvidence: discovered.evidence.length,
        groundedEvidence: evidence.length,
        inferredTopics: inferredTopics.length,
        diagnostics,
      },
      contentUnderstanding: {
        ...detector.status(),
        scan: stats,
        visuallyUnderstood: evidence.filter((row) => row.contentSummary).length,
      },
    }));
  } finally {
    // connectOverCDP.close() only detaches Playwright from the already-running
    // user Chrome; it does not delete the profile/session used by Front.
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: clean(error?.message || error, 500) }));
  process.exitCode = 1;
});
