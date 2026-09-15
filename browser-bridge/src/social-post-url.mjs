// Only absolute HTTP(S) post URLs are eligible for media navigation.
export function canonicalSocialPostUrl(value, platform) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    if ((!platform || platform === 'X') && /^(?:www\.)?(?:x|twitter)\.com$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/);
      return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
    }
    if ((!platform || platform === 'TikTok') && /^(?:www\.)?tiktok\.com$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/@([A-Za-z0-9_.]+)\/video\/(\d{10,25})\/?$/);
      return m ? `https://www.tiktok.com/@${m[1]}/video/${m[2]}` : null;
    }
  } catch {}
  return null;
}
