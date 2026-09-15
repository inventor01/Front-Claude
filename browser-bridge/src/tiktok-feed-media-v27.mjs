// Preserve identity-scoped media from the authenticated feed. Promotional
// videos can play in For You while their constructed public permalink fails.
export function tikTokFeedMedia(payload) {
  const found = new Map();
  for (const item of payload?.itemList || []) {
    if (!/^\d{10,25}$/.test(String(item?.id || '')) || !item.video) continue;
    const video = item.video;
    const urls = [video.playAddr, ...(video.PlayAddrStruct?.UrlList || []),
      ...(video.bitrateInfo || []).flatMap(variant => variant.PlayAddr?.UrlList || [])];
    const mediaCandidates = [...new Set(urls.filter(url => typeof url === 'string' && /^https:\/\//.test(url)))]
      .slice(0, 12).map(url => ({ url, type: 'video/mp4', source: 'authenticated-feed' }));
    if (!mediaCandidates.length) continue;
    found.set(String(item.id), {
      mediaCandidates, mediaDuration: Number(video.duration || 0) / (item.isAd ? 1000 : 1),
      mediaAuthor: item.author?.uniqueId || '', mediaIsAd: item.isAd === true,
    });
  }
  return found;
}

export function attachTikTokFeedMedia(row, media) {
  const item = media.get(String(row.id).replace(/^tiktok:browser:/, ''));
  if (!item || (item.mediaAuthor && item.mediaAuthor.toLowerCase() !== String(row.author).toLowerCase())) return row;
  return { ...row, ...item };
}
