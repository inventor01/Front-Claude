import test from 'node:test';
import assert from 'node:assert/strict';
import {dedupeSocialContext,meaningfulSocialContext,normalizeSocialContextRow,socialContextSummary,socialContextWeight} from '../src/social-context-v26.mjs';

test('comments and replies are supporting evidence with lower weight',()=>{
 assert.equal(socialContextWeight('comment'),.3);
 assert.equal(socialContextWeight('reply'),.3);
 assert.equal(socialContextWeight('quote'),.7);
 assert.equal(socialContextWeight('top-level'),1);
});

test('generic reaction noise is rejected while useful identity/origin context survives',()=>{
 assert.equal(meaningfulSocialContext('😂😂😂'),false);
 assert.equal(meaningfulSocialContext('lol'),false);
 assert.equal(meaningfulSocialContext('The original clip was from his Twitch stream'),true);
 const row=normalizeSocialContextRow({platform:'TikTok',parentId:'p1',author:'@viewer',content:'People are calling this the Daejon Love meme'});
 assert(row);
 assert.equal(row.evidenceRole,'comment');
 assert.equal(row.socialContextWeight,.3);
});

test('duplicate comments cannot inflate support counts',()=>{
 const rows=[
  {platform:'TikTok',parentId:'p1',author:'a',content:'This came from Twitch'},
  {platform:'TikTok',parentId:'p1',author:'@a',content:'This came from Twitch'},
  {platform:'TikTok',parentId:'p1',author:'b',content:'Original was his Twitch stream'},
 ];
 const deduped=dedupeSocialContext(rows);
 assert.equal(deduped.length,2);
 const summary=socialContextSummary(rows);
 assert.equal(summary.creators,2);
 assert.equal(summary.parents,1);
 assert.equal(summary.weightedSupport,.6);
});
