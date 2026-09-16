import test from 'node:test';
import assert from 'node:assert/strict';
import { tikTokFeedMedia, attachTikTokFeedMedia } from '../src/tiktok-feed-media-v27.mjs';
import { mergeTikTokObservations, groundedTikTokEvidence } from '../src/tiktok-observation-v21.mjs';

test('feed-only ads retain their own authenticated media through collection', () => {
  const id = '7685470299579518230';
  const row = { id: `tiktok:browser:${id}`, platform: 'TikTok', author: 'creator', url: `https://www.tiktok.com/@creator/video/${id}`, content: 'Discover more today!' };
  const media = tikTokFeedMedia({ itemList: [{ id, isAd: true, author: { uniqueId: 'creator' }, video: { duration: 11881, playAddr: 'https://v16.tiktokcdn-us.com/video/ad?signature=fixture' } }] });
  const enriched = attachTikTokFeedMedia(row, media);
  assert.equal(enriched.mediaDuration, 11.881);
  assert.equal(enriched.mediaIsAd, true);
  assert.equal(enriched.mediaCandidates[0].source, 'authenticated-feed');
  const retained = groundedTikTokEvidence(mergeTikTokObservations([enriched], [row]));
  assert.equal(retained[0].mediaCandidates[0].url, enriched.mediaCandidates[0].url);
  assert.equal(attachTikTokFeedMedia({ ...row, author: 'different' }, media).mediaCandidates, undefined);
});

test('organic video variants retain URL queries and deduplicate without mixing identities', () => {
  const media = tikTokFeedMedia({ itemList: [{ id: '7685470299579518230', video: { duration: 20, playAddr: 'https://cdn.test/video?sig=1', PlayAddrStruct: { UrlList: ['https://cdn.test/video?sig=1'] }, bitrateInfo: [{ PlayAddr: { UrlList: ['https://cdn.test/other?sig=2'] } }] } }] });
  assert.equal(media.get('7685470299579518230').mediaCandidates.length, 2);
  assert.equal(media.get('7685470299579518230').mediaDuration, 20);
  assert.equal(attachTikTokFeedMedia({ id: 'tiktok:browser:7685470299579518231' }, media).mediaCandidates, undefined);
});
