import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {extractX} from '../src/x-feed-extractor.mjs';
test('X chooses timestamp permalink over analytics and retains media-only cards',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {const page=await browser.newPage();await page.setContent(`<article data-testid="tweet"><a href="https://x.com/person/status/123456789/analytics">analytics</a><a href="https://x.com/person/status/123456789"><time datetime="2026-09-13T12:00:00Z"></time></a><div data-testid="tweetText">Specific rocket launch event</div></article><article data-testid="tweet"><a href="https://x.com/other/status/987654321">post</a><video poster="https://example.com/frame.jpg"></video></article>`);const rows=await extractX(page,'test');assert.equal(rows.length,2);assert.equal(rows[0].url,'https://x.com/person/status/123456789');assert.equal(rows[1].mediaType,'video');assert.equal(rows[1].content,'');}finally{await browser.close();}
});
test('X DOM errors are surfaced',async()=>{await assert.rejects(extractX({evaluate:async()=>{throw Error('detached')}},'test'),/detached/);});
