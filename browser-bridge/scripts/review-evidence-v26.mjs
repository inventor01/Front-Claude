import fs from 'node:fs';
import {chromium} from 'playwright';
import {canonicalSocialPostUrl} from '../src/social-post-url.mjs';
const artifact=JSON.parse(fs.readFileSync(process.argv[2] || new URL('../../docs/qa/v26-release-current-scan.json',import.meta.url),'utf8'));
const source=artifact.live || artifact;
let seed=260913;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const selected=['X','TikTok'].flatMap(platform=>source.evidence.filter(r=>r.platform===platform).map(row=>({row,order:random()})).sort((a,b)=>a.order-b.order).slice(0,10).map(x=>x.row));
const browser=await chromium.connectOverCDP('http://127.0.0.1:43982',{noDefaults:true,timeout:10000});
const page=await browser.contexts()[0].newPage();const reviews=[];
try{
 for(const row of selected){
  const url=canonicalSocialPostUrl(row.url,row.platform);if(!url)throw new Error('Invalid review URL');
  try{
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await page.locator(row.platform==='X'?'article[data-testid="tweet"]':'video').first().waitFor({state:'attached',timeout:15000}).catch(()=>{});await page.waitForTimeout(700);
   const dom=await page.evaluate(({url,platform})=>{
    const id=url.split('/').at(-1);
    const candidates=[...document.querySelectorAll(platform==='X'?'article[data-testid="tweet"]':'[data-e2e="recommend-list-item-container"]')];
    const card=candidates.find(card=>platform==='X'?[...card.querySelectorAll('a[href*="/status/"]')].some(a=>a.href.split('?')[0].endsWith(`/status/${id}`)):Boolean(card.querySelector(`[id$="-${id}"]`)));
    return {url:location.href,title:document.title,matchedCard:Boolean(card),text:card?[...card.querySelectorAll(platform==='X'?'[data-testid="tweetText"]':'[data-e2e="video-desc"]')].map(n=>n.textContent).join(' '):'',bodyExcerpt:document.body.innerText.slice(0,1200)};
   },{url,platform:row.platform});
   reviews.push({evidence:row,source:dom});console.log(`${row.platform} ${row.author}: matchedCard=${dom.matchedCard}`);
  }catch(error){reviews.push({evidence:row,error:error.message});console.log(`${row.platform} ${row.author}: ${error.message}`);}
  fs.writeFileSync(new URL('../../docs/qa/v26-manual-review-sources.json',import.meta.url),JSON.stringify({scanId:source.scanId,seed:260913,reviews},null,2));
 }
}finally{await page.close();}
process.exit(0);
