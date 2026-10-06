import { createHash } from 'node:crypto';
import { canonicalSocialPostUrl } from './social-post-url.mjs';

const clean=(value,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export const SOCIAL_COMMENT_VERSION=31;

export function socialCommentId({platform='TikTok',parentUrl='',author='',content=''}) {
  const hash=createHash('sha256').update([platform,parentUrl,author,clean(content,900)].join('|')).digest('hex').slice(0,18);
  return 'social-comment:'+String(platform).toLowerCase()+':'+hash;
}

export function normalizeSocialComment(raw,{platform='TikTok',parentUrl,parentEvidenceId=null,subject,now=Date.now()}={}) {
  const url=canonicalSocialPostUrl(parentUrl,platform);
  const content=clean(raw?.content,1400);
  const author=clean(raw?.author,120).replace(/^@/,'');
  const socialArbSubject=clean(subject,160);
  if(!url||!content||content.length<3||!author||!socialArbSubject)return null;
  if(/^(?:reply|replies|like|likes|view more|see more|translate)$/i.test(content))return null;
  return {
    id:socialCommentId({platform,parentUrl:url,author,content}),
    platform,
    author,
    url,
    parentUrl:url,
    parentEvidenceId:parentEvidenceId?clean(parentEvidenceId,180):null,
    content,
    published:Number.isFinite(Number(raw?.published))?Number(raw.published):null,
    commentLikes:Number.isFinite(Number(raw?.likes))?Number(raw.likes):null,
    evidenceType:'comment',
    socialArbSubject,
    provenance:'Front Social Arb · '+platform+' comments',
    firstObserved:now,
  };
}

export function selectCommentTargets(signals=[],{mode='scout',maxSignals,maxPostsPerSignal=2}={}) {
  const signalLimit=Math.max(1,Math.min(6,Number(maxSignals||(mode==='deep'?3:1))));
  const postLimit=Math.max(1,Math.min(3,Number(maxPostsPerSignal||2)));
  const out=[];
  const seen=new Set();
  const signalKeys=new Set();
  for(const signal of signals.slice(0,signalLimit*3)) {
    if(!['HIGH_SIGNAL','RISING','EARLY'].includes(String(signal?.status||''))&&Number(signal?.behaviorCount||0)<2)continue;
    let added=0;
    for(const evidence of Array.isArray(signal?.evidence)?signal.evidence:[]) {
      if(added>=postLimit)break;
      const url=canonicalSocialPostUrl(evidence?.url,'TikTok');
      if(!url||!url.includes('tiktok.com/')||seen.has(url))continue;
      seen.add(url);
      signalKeys.add(String(signal.key));
      out.push({
        signalKey:clean(signal.key,180),
        subject:clean(signal.title||signal.product||signal.key,160),
        parentEvidenceId:clean(evidence.id,180)||null,
        url,
      });
      added++;
    }
    if(signalKeys.size>=signalLimit)break;
  }
  return out.slice(0,signalLimit*postLimit);
}

async function openComments(page) {
  const selectors=[
    '[data-e2e="comment-icon"]',
    '[data-e2e*="comment-icon"]',
    'button[aria-label*="comment" i]',
    '[role="button"][aria-label*="comment" i]',
  ];
  for(const selector of selectors) {
    const locator=page.locator(selector).first();
    try {
      if(await locator.count()&&await locator.isVisible()) {
        await locator.click({timeout:2500}).catch(()=>{});
        await page.waitForTimeout(900);
        return true;
      }
    } catch {}
  }
  return false;
}

async function readVisibleTikTokComments(page,limit=80) {
  return page.evaluate(({limit})=>{
    const clean=(value,max=1400)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
    const selectors=[
      '[data-e2e="comment-level-1"]',
      '[data-e2e*="comment-level-1"]',
      '[data-e2e*="comment-item"]',
      '[class*="DivCommentItemContainer"]',
      '[class*="CommentItem"]',
    ];
    const nodes=[...document.querySelectorAll(selectors.join(','))].slice(0,Math.max(limit*3,120));
    const rows=[];
    const seen=new Set();
    for(const node of nodes) {
      const authorAnchor=node.querySelector('a[href^="/@"],a[href*="tiktok.com/@"]');
      const authorHref=authorAnchor?.getAttribute('href')||authorAnchor?.href||'';
      const author=(authorHref.match(/\/@([A-Za-z0-9_.]+)/)?.[1]||clean(authorAnchor?.textContent,120)).replace(/^@/,'');
      if(!author)continue;
      const preferred=[...node.querySelectorAll('[data-e2e*="comment-text"],[data-e2e*="comment-content"],p,span')]
        .map((el)=>clean(el.textContent,1400))
        .filter((text)=>text.length>=3&&text.toLowerCase()!==author.toLowerCase())
        .sort((a,b)=>b.length-a.length);
      let content=preferred.find((text)=>!/^(?:reply|replies|like|likes|view more|see more|translate|\d+[smhdw])$/i.test(text))||'';
      if(!content) {
        const escaped=author.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
        content=clean(node.innerText||node.textContent,1400).replace(new RegExp('^@?'+escaped+'\\s*','i'),'');
      }
      content=clean(content,1400);
      if(content.length<3)continue;
      const key=(author+'|'+content).toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      const likesText=[...node.querySelectorAll('button,span')].map((el)=>clean(el.textContent,80)).find((text)=>/^\d+(?:[.,]\d+)?[KMB]?$/.test(text))||'';
      rows.push({author,content,likesText});
      if(rows.length>=limit)break;
    }
    return {rows};
  },{limit}).catch(()=>({rows:[]}));
}

async function scrollCommentSurface(page) {
  return page.evaluate(()=>{
    const node=document.querySelector('[data-e2e="comment-level-1"],[data-e2e*="comment-level-1"],[data-e2e*="comment-item"],[class*="DivCommentItemContainer"],[class*="CommentItem"]');
    let p=node;
    while(p) {
      if(p.scrollHeight>p.clientHeight+80) {
        const before=p.scrollTop;
        p.scrollBy({top:Math.max(500,p.clientHeight*.85),behavior:'instant'});
        return {scrolled:true,before,after:p.scrollTop};
      }
      p=p.parentElement;
    }
    window.scrollBy({top:700,behavior:'instant'});
    return {scrolled:true,before:null,after:null};
  }).catch(()=>({scrolled:false}));
}

export async function collectTikTokComments(context,target,{maxComments=80,scrollPasses=4,timeoutMs=25000}={}) {
  const page=await context.newPage();
  const started=Date.now();
  const accepted=new Map();
  try {
    await page.goto(target.url,{waitUntil:'commit',timeout:timeoutMs});
    await page.waitForLoadState('domcontentloaded',{timeout:8000}).catch(()=>{});
    await page.waitForTimeout(1800);
    if(/\/login|login\?/i.test(page.url()))throw new Error('TikTok redirected comment investigation to login.');
    await openComments(page);
    for(let pass=0;pass<=scrollPasses;pass++) {
      const visible=await readVisibleTikTokComments(page,maxComments);
      for(const raw of visible.rows) {
        const row=normalizeSocialComment(raw,{
          platform:'TikTok',
          parentUrl:target.url,
          parentEvidenceId:target.parentEvidenceId,
          subject:target.subject,
        });
        if(row)accepted.set(row.id,row);
        if(accepted.size>=maxComments)break;
      }
      if(accepted.size>=maxComments||pass===scrollPasses)break;
      await scrollCommentSurface(page);
      await sleep(650);
    }
    return {
      rows:[...accepted.values()],
      stats:{url:target.url,subject:target.subject,comments:accepted.size,elapsedMs:Date.now()-started,error:null},
    };
  } catch(error) {
    return {
      rows:[...accepted.values()],
      stats:{url:target.url,subject:target.subject,comments:accepted.size,elapsedMs:Date.now()-started,error:clean(error?.message||error,260)},
    };
  } finally {
    await page.close().catch(()=>{});
  }
}

export async function investigateSocialComments(context,signals=[],options={}) {
  const targets=selectCommentTargets(signals,options);
  const rows=[];
  const sources=[];
  const errors=[];
  for(const target of targets) {
    const result=await collectTikTokComments(context,target,options);
    rows.push(...result.rows);
    sources.push(result.stats);
    if(result.stats.error)errors.push(target.url+': '+result.stats.error);
  }
  const deduped=[...new Map(rows.map((row)=>[row.id,row])).values()];
  return {
    rows:deduped,
    stats:{
      version:SOCIAL_COMMENT_VERSION,
      targets:targets.length,
      comments:deduped.length,
      sources,
      errors:errors.slice(0,12),
    },
  };
}
