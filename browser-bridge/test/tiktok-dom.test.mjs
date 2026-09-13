import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractTikTokAnchors } from '../src/tiktok-observer-v21.mjs';

test('real DOM feed and search extraction excludes local personal cards, not persistent inbox shells', async () => {
  // This is a separate disposable browser, never the authenticated CDP browser.
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const page = await browser.newPage();
    const card = (n, e2e, text='Specific mascot halftime incident') => `<div data-e2e="${e2e}"><a href="https://www.tiktok.com/@creator${n}/video/123456789000${n}">${text}</a></div>`;
    await page.setContent(`<div data-e2e="inbox-shell">${card(1,'recommend-list-item-container')}${card(2,'search-card')}${['inbox-list-item','notification-item','activity-item','message-item','user-post-item'].map((kind,i)=>`<div data-e2e="${kind}">${card(i+3,'search-card')}</div>`).join('')}${card(8,'recommend-item','liked your video')}${card(9,'unknown-wrapper')}</div>`);
    const result = await extractTikTokAnchors(page, 'origin/investigation fixture');
    assert.deepEqual(result.observations.map(r=>r.author), ['creator1','creator2']);
    assert.equal(result.diagnostics.localActivityRejected,5);
    assert.equal(result.diagnostics.activityTextRejected,1);
    assert.equal(result.diagnostics.withoutContainer,1);
    assert(result.observations.every(r=>r.provenance==='origin/investigation fixture'));
  } finally { await browser.close(); }
});

test('anchorless one-column feed binds player ID and avatar author inside the same feed card', async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const page = await browser.newPage();
    const card = `<article data-e2e="recommend-list-item-container"><section data-e2e="feed-video"><div id="xgwrapper-0-7685075394990509342"><video></video></div></section><a data-e2e="video-author-avatar" href="/@semxkey">semkey</a><div data-e2e="video-desc">Mascot halftime fall</div></article>`;
    await page.setContent(`<div data-e2e="inbox-list-item"><a href="https://www.tiktok.com/@other/video/7222918052449439019">liked your video</a>${card}</div>${card}`);
    const result=await extractTikTokAnchors(page,'discovery');
    assert.equal(result.observations.length,1);
    assert.equal(result.observations[0].url,'https://www.tiktok.com/@semxkey/video/7685075394990509342');
    assert.equal(result.observations[0].content,'Mascot halftime fall');
    assert.equal(result.diagnostics.playerCardsAccepted,1);
    assert.equal(result.diagnostics.acceptedAnchors,0);
  } finally { await browser.close(); }
});

test('DOM evaluation failure cannot masquerade as a successful empty feed',async()=>{
 await assert.rejects(extractTikTokAnchors({evaluate:async()=>{throw new Error('renderer disconnected')}},'discovery'),/renderer disconnected/);
});

test('scroll helper advances the nested feed and the root X surface without wheel input',async()=>{
 const {scrollFeedPage}=await import('../src/feed-scroll.mjs');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage();
  await page.setContent('<div style="height:200px;overflow-y:scroll"><article data-e2e="recommend-list-item-container" style="height:600px">card</article><div style="height:2000px"></div></div>');
  let r=await scrollFeedPage(page,'article',300);assert.equal(r.nested,true);assert(r.after>r.before);
  await page.setContent('<article data-testid="tweet">tweet</article><div style="height:3000px"></div>');
  r=await scrollFeedPage(page,'article',950);assert(r.after>r.before);
 }finally{await browser.close();}
});

test('one new X post per pass is progress, not a stale feed',async()=>{
 const {nextStalePassCount}=await import('../src/feed-scroll.mjs');
 assert.equal(nextStalePassCount(4,5,3),0);assert.equal(nextStalePassCount(5,5,3),4);
});

test('Ollama contact sheet preserves twelve ordered frames within one image',async()=>{
 const {buildTimelineContactSheet}=await import('../src/content-understanding.mjs');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage();
  const frame=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=640;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,360,640);return c.toDataURL('image/jpeg').split(',')[1];});
  const sheet=await buildTimelineContactSheet(page,Array.from({length:12},(_,time)=>({base64:frame,time})));
  assert.equal(sheet.representedFrames,12);
  const size=await page.evaluate(base64=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve({w:i.width,h:i.height});i.src=`data:image/jpeg;base64,${base64}`;}),sheet.base64);
  assert.equal(size.w,960);assert(size.w*size.h<2400000);assert(size.h>2000);
 }finally{await browser.close();}
});
