const clean = (value, max = 8000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function meaningfulTikTokText(value) {
  const text = clean(value, 8000);
  if (text.length < 3 || !/[\p{L}]/u.test(text)) return false;
  if (/^(?:home|explore|for you|following|search|profile|video|photo|sound|show more|more|views?|likes?|shares?|comments?)$/i.test(text)) return false;
  if (/^[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?$/i.test(text)) return false;
  return true;
}

export function parseTikTokVideoUrl(value) {
  try {
    const url = new URL(value, 'https://www.tiktok.com');
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d{10,25})/);
    if (!match) return null;
    const author = decodeURIComponent(match[1]).replace(/^@/, '').trim();
    const id = match[2];
    if (!author || !id) return null;
    return { author, id, url: `https://www.tiktok.com/@${author}/video/${id}` };
  } catch {
    return null;
  }
}

export function bestTikTokText(values = [], author = '') {
  const authorKey = String(author || '').replace(/^@/, '').toLowerCase();
  for (const raw of values) {
    let text = clean(raw, 8000);
    if (!meaningfulTikTokText(text)) continue;
    if (authorKey) {
      const lines = text.split(/\n+/).map((line) => clean(line, 1000)).filter(Boolean);
      text = lines.filter((line) => line.replace(/^@/, '').toLowerCase() !== authorKey).join(' ');
    }
    if (meaningfulTikTokText(text)) return clean(text, 8000);
  }
  return '';
}

export function normalizeTikTokObservation(raw = {}, at = Date.now()) {
  const parsed = parseTikTokVideoUrl(raw.href || raw.url || '');
  if (!parsed) return null;
  const content = bestTikTokText([
    raw.content,
    raw.aria,
    raw.title,
    raw.alt,
    raw.containerText,
  ], parsed.author);
  return {
    id: `tiktok:browser:${parsed.id}`,
    platform: 'TikTok',
    author: parsed.author,
    url: parsed.url,
    content,
    published: Number.isFinite(Number(raw.published)) ? Number(raw.published) : null,
    views: Number.isFinite(Number(raw.views)) ? Number(raw.views) : null,
    likes: Number.isFinite(Number(raw.likes)) ? Number(raw.likes) : null,
    comments: Number.isFinite(Number(raw.comments)) ? Number(raw.comments) : null,
    shares: Number.isFinite(Number(raw.shares)) ? Number(raw.shares) : null,
    soundId: clean(raw.soundId, 100) || null,
    soundTitle: clean(raw.soundTitle, 200) || null,
    coverUrl: clean(raw.coverUrl, 2048) || null,
    mediaType: 'video',
    provenance: clean(raw.provenance || 'TikTok broad live observation', 240),
    firstObserved: Number.isFinite(Number(raw.firstObserved)) ? Number(raw.firstObserved) : at,
    lastObserved: at,
    observedOnly: !meaningfulTikTokText(content),
  };
}

function quality(row) {
  let score = 0;
  if (meaningfulTikTokText(row?.content)) score += Math.min(40, String(row.content).length / 20);
  if (Number.isFinite(row?.views)) score += 12;
  if (Number.isFinite(row?.likes)) score += 10;
  if (row?.soundId || row?.soundTitle) score += 8;
  if (row?.coverUrl) score += 4;
  return score;
}

export function mergeTikTokObservations(existing = [], incoming = [], { limit = 1200 } = {}) {
  const map = new Map();
  for (const raw of [...existing, ...incoming]) {
    const row = raw?.platform === 'TikTok' && raw?.url ? raw : normalizeTikTokObservation(raw);
    if (!row?.url || row.platform !== 'TikTok') continue;
    const parsed = parseTikTokVideoUrl(row.url);
    if (!parsed) continue;
    const key = parsed.url;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, { ...row, url: key });
      continue;
    }
    const preferred = quality(row) >= quality(prior) ? row : prior;
    const secondary = preferred === row ? prior : row;
    const firstObserved = Math.min(
      Number.isFinite(Number(prior.firstObserved)) ? Number(prior.firstObserved) : Date.now(),
      Number.isFinite(Number(row.firstObserved)) ? Number(row.firstObserved) : Date.now(),
    );
    map.set(key, {
      ...secondary,
      ...preferred,
      url: key,
      firstObserved,
      lastObserved: Math.max(Number(prior.lastObserved || 0), Number(row.lastObserved || 0), Date.now()),
      observedOnly: !meaningfulTikTokText(preferred.content || secondary.content),
    });
  }
  return [...map.values()]
    .sort((a, b) => Number(a.firstObserved || 0) - Number(b.firstObserved || 0))
    .slice(-Math.max(1, Number(limit) || 1200));
}

export function groundedTikTokEvidence(rows = []) {
  return rows.filter((row) => row?.platform === 'TikTok' && parseTikTokVideoUrl(row.url) && meaningfulTikTokText(row.content))
    .map((row) => ({ ...row, observedOnly: undefined }));
}

export function mergeScanEvidence(base = [], extra = []) {
  const map = new Map();
  const put = (row) => {
    if (!row?.platform || !row?.url || !row?.id) return;
    const key = `${row.platform}|${row.url}`;
    const prior = map.get(key);
    if (!prior) return void map.set(key, row);
    const preferred = String(row.contentSummary || row.content || '').length >= String(prior.contentSummary || prior.content || '').length ? row : prior;
    const secondary = preferred === row ? prior : row;
    map.set(key, {
      ...secondary,
      ...preferred,
      firstObserved: Math.min(Number(prior.firstObserved || Infinity), Number(row.firstObserved || Infinity)),
    });
  };
  base.forEach(put);
  extra.forEach(put);
  return [...map.values()].map((row) => Number.isFinite(row.firstObserved) ? row : ({ ...row, firstObserved: Date.now() }));
}
