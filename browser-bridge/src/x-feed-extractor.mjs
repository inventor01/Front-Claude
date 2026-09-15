import { canonicalSocialPostUrl } from './social-post-url.mjs';
import { cleanEvidenceContent, extractHashtags, stableId } from './core.mjs';
import { mergeRichEvidence } from './adaptive-intelligence.mjs';
const canonicalXUrl = value => canonicalSocialPostUrl(value, 'X');
const hasText = value => /[\p{L}]/u.test(String(value || '').trim());
export async function extractX(page, provenance, limit = 120) {
  const raw = await page.evaluate((max) => {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, max).map((article) => {
      const links = [...article.querySelectorAll('a[href*="/status/"]')].map(a => a.href);
      const status = article.querySelector('time')?.closest('a')?.href || links.find(href => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?$/.test(href)) || '';
      const text = [...article.querySelectorAll('[data-testid="tweetText"]')].map((n) => n.textContent || '').join(' ').trim();
      const published = article.querySelector('time')?.getAttribute('datetime') || null;
      const poster = article.querySelector('video')?.getAttribute('poster') || article.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') || null;
      const video = Boolean(article.querySelector('video,[data-testid="videoPlayer"]'));
      return { status, text, published, poster, video };
    });
  }, Math.max(limit * 2, limit));
  const out = [];
  for (const row of raw) {
    const url = canonicalXUrl(row.status);
    if (!url) continue;
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const author = parts[0] || 'X';
    const content = cleanEvidenceContent('X', row.text, author);
    if (!hasText(content) && !row.poster && !row.video) continue;
    out.push({
      id: stableId('X', url, content), platform: 'X', author, url, content,
      published: row.published && Number.isFinite(Date.parse(row.published)) ? Date.parse(row.published) : null,
      views: null, likes: null, coverUrl: row.poster, mediaType: row.video ? 'video' : (row.poster ? 'image' : 'text'),
      hashtags: extractHashtags(content, 30), provenance, firstObserved: Date.now(),
    });
  }
  return mergeRichEvidence(out).slice(0, limit);
}
