import {
  cleanEvidenceContent,
  extractHashtags,
  metricFromAria,
  stableId,
} from './core.mjs';

const clean = (value, max = 2000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function meaningful(value) {
  const text = clean(value, 1200);
  if (!text || text.length < 3) return false;
  if (/^[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?$/i.test(text)) return false;
  return /[\p{L}]/u.test(text);
}

function cleanedText(platform, author, values = []) {
  for (const value of values) {
    const text = cleanEvidenceContent(platform, value, author);
    if (meaningful(text)) return text;
  }
  return '';
}

async function scroll(page, pauseMs = 650) {
  await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.95, 760))).catch(() => {});
  await page.waitForTimeout(pauseMs).catch(() => sleep(pauseMs));
}

async function collectX(context, { limit, scrollPasses }) {
  const page = await context.newPage();
  const map = new Map();
  const diagnostics = { page: 'X For You', url: '', title: '', articles: 0, statusLinks: 0, videoPosts: 0, collected: 0 };
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1800);
    const tab = page.getByRole('tab', { name: /^For you$/i }).first();
    if (await tab.count().catch(() => 0)) await tab.click({ timeout: 2200 }).catch(() => {});
    await page.waitForTimeout(500);

    for (let pass = 0; pass <= scrollPasses && map.size < limit; pass++) {
      const articles = page.locator('article');
      const articleCount = Math.min(await articles.count().catch(() => 0), Math.max(limit * 4, 80));
      diagnostics.articles = Math.max(diagnostics.articles, articleCount);
      for (let i = 0; i < articleCount && map.size < limit; i++) {
        const article = articles.nth(i);
        const links = await article.locator('a[href*="/status/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter(Boolean)).catch(() => []);
        diagnostics.statusLinks = Math.max(diagnostics.statusLinks, links.length);
        const href = links.find((value) => /\/status\/\d+/.test(String(value))) || links[0];
        if (!href) continue;
        let url;
        let author;
        try {
          const parsed = new URL(href, 'https://x.com');
          const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
          if (!match) continue;
          author = match[1];
          url = `https://x.com/${author}/status/${match[2]}`;
        } catch { continue; }
        if (map.has(url)) continue;

        const videoCount = await article.locator('[data-testid="videoPlayer"], video').count().catch(() => 0);
        const imageCount = await article.locator('[data-testid="tweetPhoto"] img').count().catch(() => 0);
        const mediaType = videoCount ? 'video' : imageCount ? 'image' : 'text';
        if (videoCount) diagnostics.videoPosts += 1;

        const tweetText = await article.locator('[data-testid="tweetText"]').allInnerTexts().catch(() => []);
        const langText = tweetText.length ? [] : await article.locator('div[lang]').allInnerTexts().catch(() => []);
        const content = cleanedText('X', author, [...tweetText, ...langText]);
        // v17 previously discarded these before vision could ever see them. A
        // video with no usable caption is still valid evidence for v18 because
        // Qwen/Ollama can ground it from the actual timeline frames.
        if (!content && mediaType !== 'video') continue;

        const aria = await article.getAttribute('aria-label').catch(() => '') || '';
        const time = await article.locator('time').first().getAttribute('datetime').catch(() => null);
        const published = time && Number.isFinite(Date.parse(time)) ? Date.parse(time) : null;
        const coverUrl = await article.locator('video').first().getAttribute('poster').catch(() => null)
          || await article.locator('[data-testid="tweetPhoto"] img').first().getAttribute('src').catch(() => null);
        map.set(url, {
          id: stableId('X', url, content || `${author}:${url}`),
          platform: 'X', author, url, content, published,
          views: metricFromAria(aria, 'views'), likes: metricFromAria(aria, 'likes'),
          replies: metricFromAria(aria, 'replies'), reposts: metricFromAria(aria, 'reposts') ?? metricFromAria(aria, 'retweets'),
          hashtags: content ? extractHashtags(content, 30) : [],
          mediaType, coverUrl, firstObserved: Date.now(),
          visualCandidate: mediaType === 'video' && !content,
          provenance: 'Local Chrome browser · v18 zero-result visual fallback · X For You',
        });
      }
      if (pass < scrollPasses && map.size < limit) await scroll(page, 700);
    }
    diagnostics.url = page.url();
    diagnostics.title = clean(await page.title().catch(() => ''), 180);
    diagnostics.collected = map.size;
    return { rows: [...map.values()], diagnostics };
  } finally {
    await page.close().catch(() => {});
  }
}

async function scanTikTokPage(page, map, diagnostics, { limit, scrollPasses, provenance }) {
  for (let pass = 0; pass <= scrollPasses && map.size < limit; pass++) {
    const anchors = page.locator('a[href*="/video/"]');
    const count = Math.min(await anchors.count().catch(() => 0), Math.max(limit * 6, 120));
    diagnostics.videoLinks = Math.max(diagnostics.videoLinks, count);
    for (let i = 0; i < count && map.size < limit; i++) {
      const anchor = anchors.nth(i);
      const href = await anchor.getAttribute('href').catch(() => null);
      if (!href) continue;
      let parsed;
      try { parsed = new URL(href, 'https://www.tiktok.com'); } catch { continue; }
      const match = parsed.pathname.match(/^\/@([^/]+)\/video\/(\d{10,25})/);
      if (!match) continue;
      const author = decodeURIComponent(match[1]);
      const id = match[2];
      const url = `https://www.tiktok.com/@${author}/video/${id}`;
      if (map.has(url)) continue;
      const aria = await anchor.getAttribute('aria-label').catch(() => '') || '';
      const title = await anchor.getAttribute('title').catch(() => '') || '';
      const imageAlt = await anchor.locator('img').first().getAttribute('alt').catch(() => '') || '';
      const content = cleanedText('TikTok', author, [aria, title, imageAlt]);
      const coverUrl = await anchor.locator('img').first().getAttribute('src').catch(() => null);
      map.set(url, {
        id: `tiktok:browser:${id}`, platform: 'TikTok', author, url, content,
        published: null, views: null, likes: null, hashtags: content ? extractHashtags(content, 30) : [],
        mediaType: 'video', coverUrl, firstObserved: Date.now(), visualCandidate: !content,
        provenance,
      });
    }
    if (pass < scrollPasses && map.size < limit) await scroll(page, 750);
  }
}

async function collectTikTok(context, { limit, scrollPasses }) {
  const page = await context.newPage();
  const map = new Map();
  const diagnostics = { page: 'TikTok For You', url: '', title: '', videoLinks: 0, collected: 0, usedExploreFallback: false };
  try {
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(async () => {
      await page.goto('https://www.tiktok.com/explore', { waitUntil: 'domcontentloaded', timeout: 20000 });
      diagnostics.usedExploreFallback = true;
    });
    await page.waitForTimeout(2200);
    await scanTikTokPage(page, map, diagnostics, {
      limit, scrollPasses,
      provenance: 'Local Chrome browser · v18 zero-result visual fallback · TikTok For You',
    });
    if (!map.size && !diagnostics.usedExploreFallback) {
      diagnostics.usedExploreFallback = true;
      await page.goto('https://www.tiktok.com/explore', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await scanTikTokPage(page, map, diagnostics, {
        limit, scrollPasses: Math.min(3, scrollPasses),
        provenance: 'Local Chrome browser · v18 zero-result visual fallback · TikTok Explore',
      });
    }
    diagnostics.url = page.url();
    diagnostics.title = clean(await page.title().catch(() => ''), 180);
    diagnostics.collected = map.size;
    return { rows: [...map.values()], diagnostics };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function collectFallbackEvidence(context, { targetPerPlatform = 32, scrollPasses = 5 } = {}) {
  const limit = Math.max(8, Math.min(60, Number(targetPerPlatform) || 32));
  const passes = Math.max(1, Math.min(8, Number(scrollPasses) || 5));
  const errors = [];
  const diagnostics = {};
  const evidence = [];

  try {
    const x = await collectX(context, { limit, scrollPasses: passes });
    evidence.push(...x.rows); diagnostics.x = x.diagnostics;
  } catch (error) {
    errors.push(`v18 X visual fallback: ${clean(error?.message || error, 260)}`);
  }
  try {
    const tiktok = await collectTikTok(context, { limit, scrollPasses: passes });
    evidence.push(...tiktok.rows); diagnostics.tiktok = tiktok.diagnostics;
  } catch (error) {
    errors.push(`v18 TikTok visual fallback: ${clean(error?.message || error, 260)}`);
  }

  const unique = new Map();
  for (const row of evidence) if (row?.platform && row?.url && row?.id) unique.set(`${row.platform}|${row.url}`, row);
  return { evidence: [...unique.values()], diagnostics, errors };
}
