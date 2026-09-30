import { cleanEvidenceContent, extractHashtags, parseCompactNumber } from './core.mjs';
import { canonicalSocialPostUrl } from './social-post-url.mjs';

const clean=(value,max=8000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const hasText=(value)=>{const text=clean(value);return text.length>=3&&/[\p{L}]/u.test(text);};

export function instagramTag(value=''){
  return clean(value,120).normalize('NFKC').replace(/^#/,'').replace(/[^\p{L}\p{N}_]+/gu,'').slice(0,80);
}

export async function extractInstagramPage(page,provenance='Front · Instagram',limit=80){
  const current=page.url();
  if(/instagram\.com\/accounts\/login/i.test(current))throw new Error('Instagram is not signed in in the dedicated Front Chrome profile.');
  const raw=await page.evaluate(()=>{
    const articles=[...document.querySelectorAll('article')].slice(0,120);
    const source=articles.length?articles:[...document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')].slice(0,120).map((a)=>a.closest('div')||a);
    return source.map((node)=>{
      const anchors=[...node.querySelectorAll?.('a[href]')||[]];
      const post=anchors.map((a)=>a.href||a.getAttribute('href')).find((href)=>/instagram\.com\/(?:p|reel|tv)\//i.test(String(href||'')))||'';
      const authorHref=anchors.map((a)=>a.getAttribute('href')||'').find((href)=>/^\/[A-Za-z0-9._]{1,30}\/?$/.test(href)&&!/^\/(?:explore|accounts|direct|reels?)\/?$/i.test(href))||'';
      const text=node.innerText||node.textContent||'';
      const img=node.querySelector?.('img');
      const video=node.querySelector?.('video');
      const time=node.querySelector?.('time');
      const aria=node.getAttribute?.('aria-label')||'';
      return {post,authorHref,text,coverUrl:img?.src||null,hasVideo:Boolean(video),published:time?.getAttribute('datetime')||null,aria};
    });
  }).catch(()=>[]);
  const out=[],seen=new Set();
  for(const item of raw){
    const url=canonicalSocialPostUrl(item.post,'Instagram');
    if(!url||seen.has(url))continue;
    seen.add(url);
    const author=String(item.authorHref||'').replace(/^\//,'').replace(/\/$/,'')||'Instagram';
    const content=cleanEvidenceContent('Instagram',item.text,author);
    if(!hasText(content))continue;
    const published=item.published&&Number.isFinite(Date.parse(item.published))?Date.parse(item.published):null;
    const likesMatch=String(item.aria||item.text||'').match(/([\d,.]+\s*[KMB]?)\s+likes?/i);
    const commentsMatch=String(item.aria||item.text||'').match(/([\d,.]+\s*[KMB]?)\s+comments?/i);
    out.push({
      id:`instagram:browser:${new URL(url).pathname.split('/').filter(Boolean).pop()}`,
      platform:'Instagram',
      author,
      url,
      content,
      published,
      views:null,
      likes:likesMatch?parseCompactNumber(likesMatch[1]):null,
      comments:commentsMatch?parseCompactNumber(commentsMatch[1]):null,
      shares:null,
      saves:null,
      coverUrl:item.coverUrl||null,
      mediaType:/\/reel\//i.test(url)||item.hasVideo?'video':'image',
      hashtags:extractHashtags(content,30),
      provenance,
      firstObserved:Date.now()
    });
    if(out.length>=limit)break;
  }
  return out;
}
