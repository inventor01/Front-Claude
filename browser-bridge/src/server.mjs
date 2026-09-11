import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { cleanEvidenceContent, dedupeEvidence, extractHashtags, extractTikTokItemsFromJson, inferTopics, metricFromAria, normalizeConfig, sanitizeTopic, stableId, xTrendLabel } from './core.mjs';
import { findSystemChrome, frontCdpUrl, frontLoginProfileDir, openRegularChromeForLogin, stopExistingFrontChrome, waitForCdp } from './system-browser.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const profileDir = frontLoginProfileDir(dataDir);
const configPath = path.join(dataDir, 'config.json');
const pendingPath = path.join(dataDir, 'pending-evidence.json');
const systemChrome = findSystemChrome();
const cdpPort = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const cdpUrl = frontCdpUrl(cdpPort);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(',')).split(',').map((value) => value.trim()).filter(Boolean));
fs.mkdirSync(profileDir, { recursive: true });

let browserConnection;
let context;
let config = normalizeConfig(readJson(configPath, {}));
let pendingEvidence = dedupeEvidence(readJson(pendingPath, [])).slice(-500);
let running = false;
let lastRun = null;
let lastError = null;
let lastCount = 0;
let lastTopics = [];
let nextScheduledRun = null;
let scheduleTimer;
let lastAudit = null;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Private-Network':'true','Vary':'Origin, Access-Control-Request-Private-Network'};
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
function originAllowed(req) { const origin = req.headers.origin; return !origin || allowedOrigins.has(origin); }
function json(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(payload),'Cache-Control':'no-store',...corsHeaders(req)});
  res.end(payload);
}
function queueEvidence(rows) { pendingEvidence = dedupeEvidence([...pendingEvidence, ...rows]).slice(-500); writeJson(pendingPath, pendingEvidence); }
function ackEvidence(ids) { const set = new Set(Array.isArray(ids) ? ids.map(String) : []); if (!set.size) return 0; const before = pendingEvidence.length; pendingEvidence = pendingEvidence.filter((row) => !set.has(row.id)); writeJson(pendingPath, pendingEvidence); return before - pendingEvidence.length; }
function hasMeaningfulText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3) return false;
  if (/^[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?$/i.test(text)) return false;
  if (/^(?:hashtag|caption|video|photo|sound|profile|user|creator|account|show|more|view|like|likes|quote|reply|share|follow|following|for you|explore|home|trending)$/i.test(text)) return false;
  return /[\p{L}]/u.test(text);
}
function trendSlug(rawHref) {
  if (!rawHref) return '';
  try {
    const u = new URL(rawHref, 'https://ads.tiktok.com');
    const parts = u.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => ['hashtag','trend','trends'].includes(part.toLowerCase()));
    if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]).replace(/[-_]+/g, ' ').trim();
  } catch {}
  return '';
}

async function ensureBrowser() {
  if (context && browserConnection?.isConnected?.()) return context;
  if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans. Install Chrome, then restart the Front browser bridge.');
  try {
    browserConnection = await chromium.connectOverCDP(cdpUrl);
    context = browserConnection.contexts()[0];
    if (!context) throw new Error('Front Chrome did not expose its browser context.');
    browserConnection.on('disconnected', () => { browserConnection = undefined; context = undefined; });
    return context;
  } catch (error) {
    browserConnection = undefined; context = undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Front login Chrome is not available for scanning. Click Open X + TikTok login, finish signing in, and LEAVE that Front Chrome window open while scanning. (${detail})`);
  }
}
async function newPage(url) { const browser = await ensureBrowser(); const page = await browser.newPage(); try { await page.goto(url,{waitUntil:'commit',timeout:20000}); await page.waitForLoadState('domcontentloaded',{timeout:10000}).catch(()=>{}); return page; } catch(error){ await page.close().catch(()=>{}); throw error; } }
async function scrollViewport(page, passes, pauseMs = 900) { for(let i=0;i<passes;i++){ await page.evaluate(()=>window.scrollBy(0,Math.max(window.innerHeight*.9,700))).catch(()=>{}); await page.waitForTimeout(pauseMs); } }

async function extractXArticles(page, limit, provenance) {
  const articles = page.locator('article[data-testid="tweet"]');
  const count = Math.min(await articles.count(), limit);
  const out = [];
  let skippedNoBody = 0;
  for (let i = 0; i < count; i++) {
    const article = articles.nth(i);
    const href = await article.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null);
    if (!href) continue;
    const url = href.startsWith('http') ? href : `https://x.com${href}`;
    const dt = await article.locator('time').first().getAttribute('datetime').catch(() => null);
    const published = dt && Number.isFinite(Date.parse(dt)) ? Date.parse(dt) : null;
    const wholeText = (await article.innerText().catch(() => '')).trim();
    const aria = await article.getAttribute('aria-label').catch(() => '') || wholeText;
    const views = metricFromAria(aria, 'views');
    const likes = metricFromAria(aria, 'likes');
    const statusPath = new URL(url).pathname.split('/').filter(Boolean);
    const author = statusPath[0] || 'X';
    const tweetTextParts = await article.locator('[data-testid="tweetText"]').allInnerTexts().catch(() => []);
    const directText = tweetTextParts.map((value) => value.trim()).filter(hasMeaningfulText).join(' ');
    // Never turn a card's surrounding UI/display-name/metrics into post evidence.
    // A tweet without tweetText is skipped rather than guessed.
    if (!directText) { skippedNoBody++; continue; }
    const text = cleanEvidenceContent('X', directText, author);
    if (!hasMeaningfulText(text)) { skippedNoBody++; continue; }
    out.push({id:stableId('X',url,text),platform:'X',author,url,content:text,published,views,likes,provenance});
  }
  return { rows: dedupeEvidence(out), skippedNoBody };
}

async function collectXQuery(query, limit) {
  const q=query.trim(); if(!q)return[]; const page=await newPage(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
  try { await page.waitForTimeout(2300); await scrollViewport(page,1,700); const result=await extractXArticles(page,limit,`Local Chrome browser · X Latest search · query: ${q}`); if(!result.rows.length)throw new Error(`X returned no posts with real tweet text for “${q}”.`); return result.rows; } finally { await page.close(); }
}
async function collectXHome(limit, passes) {
  const page=await newPage('https://x.com/home');
  try { await page.waitForTimeout(2500); const out=[]; for(let i=0;i<=passes;i++){ const result=await extractXArticles(page,limit,'Local Chrome browser · X Home feed sample'); out.push(...result.rows); if(dedupeEvidence(out).length>=limit||i===passes)break; await scrollViewport(page,1,850); } const unique=dedupeEvidence(out).slice(0,limit); if(!unique.length)throw new Error('X Home loaded but no posts with real tweet text were extractable.'); return unique; } finally { await page.close(); }
}
async function collectXExplore(limit) {
  const page=await newPage('https://x.com/explore/tabs/trending');
  try { await page.waitForTimeout(2800); const candidates=page.locator('a[href*="/search?q="], [data-testid="trend"]'); const count=Math.min(await candidates.count(),Math.max(limit*3,limit)); const out=[]; for(let i=0;i<count&&out.length<limit;i++){ const item=candidates.nth(i),raw=(await item.innerText().catch(()=>'' )).trim(),text=xTrendLabel(raw); if(!hasMeaningfulText(text))continue; const href=await item.getAttribute('href').catch(()=>null); const url=href?(href.startsWith('http')?href:`https://x.com${href}`):`https://x.com/search?q=${encodeURIComponent(text)}&src=trend_click&f=live`; out.push({id:stableId('X',url,text),platform:'X',author:'X Explore',url,content:text,published:null,views:null,likes:null,provenance:'Local Chrome browser · X Explore trending'}); } if(!out.length){ const body=await page.locator('body').innerText().catch(()=>'' ); for(const tag of extractHashtags(body,limit)){ if(!hasMeaningfulText(tag))continue; const url=`https://x.com/search?q=${encodeURIComponent('#'+tag)}&src=trend_click&f=live`; out.push({id:stableId('X',url,tag),platform:'X',author:'X Explore',url,content:`#${tag}`,published:null,views:null,likes:null,provenance:'Local Chrome browser · X Explore hashtag fallback'}); } } if(!out.length)throw new Error('X Explore loaded but no trend evidence was extractable.'); return out; } finally { await page.close(); }
}

async function extractTikTokPage(page, provenance, limit) {
  const extracted=await page.evaluate(()=>{const json=[];for(const script of Array.from(document.scripts)){const value=(script.textContent||'').trim();if(!value.startsWith('{')&&!value.startsWith('['))continue;try{json.push(JSON.parse(value));}catch{}}return json;});
  const items=[];for(const value of extracted)items.push(...extractTikTokItemsFromJson(value));
  const byId=new Map(items.filter((item)=>hasMeaningfulText(item.content)).map((item)=>[item.id,item]));
  const anchors=page.locator('a[href*="/video/"]');const anchorCount=Math.min(await anchors.count(),limit*3);
  for(let i=0;i<anchorCount;i++){
    const a=anchors.nth(i),href=await a.getAttribute('href').catch(()=>null);if(!href)continue;const match=href.match(/\/@([^/]+)\/video\/(\d{10,25})/);if(!match||byId.has(match[2]))continue;
    // Only caption-like accessibility metadata is accepted as fallback. Visible
    // anchor text is often a view counter and is intentionally ignored.
    const aria=(await a.getAttribute('aria-label').catch(()=>null)||'').trim();
    const title=(await a.getAttribute('title').catch(()=>null)||'').trim();
    const imageAlt=(await a.locator('img').first().getAttribute('alt').catch(()=>null)||'').trim();
    const candidates=[aria,title,imageAlt].map((value)=>cleanEvidenceContent('TikTok',value,match[1])).filter(hasMeaningfulText);
    const text=candidates.find((value)=>value.length>=4)||'';
    if(text)byId.set(match[2],{id:match[2],content:text,author:match[1],published:null,views:null,likes:null});
  }
  return [...byId.values()].slice(0,limit).flatMap((item)=>{const author=item.author||'TikTok';const url=author!=='TikTok'?`https://www.tiktok.com/@${author}/video/${item.id}`:`https://www.tiktok.com/video/${item.id}`;const content=cleanEvidenceContent('TikTok',item.content,author);if(!hasMeaningfulText(content))return[];return[{id:`tiktok:browser:${item.id}`,platform:'TikTok',author,url,content,published:item.published,views:item.views,likes:item.likes,provenance}];});
}
async function collectTikTokSearch(topic,limit){const q=sanitizeTopic(topic);if(!q)return[];const page=await newPage(`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`);try{await page.waitForTimeout(2800);await scrollViewport(page,1,800);const out=await extractTikTokPage(page,`Local Chrome browser · TikTok search · query: ${q}`,limit);if(!out.length)throw new Error(`TikTok returned no videos with real caption metadata for “${q}”.`);return out;}finally{await page.close();}}
async function collectTikTokExplore(limit,passes=2){const page=await newPage('https://www.tiktok.com/explore');try{await page.waitForTimeout(3000);const out=[];for(let i=0;i<=passes;i++){out.push(...await extractTikTokPage(page,'Local Chrome browser · TikTok Explore feed sample',limit));if(dedupeEvidence(out).length>=limit||i===passes)break;await scrollViewport(page,1,900);}const unique=dedupeEvidence(out).slice(0,limit);if(!unique.length)throw new Error('TikTok Explore loaded but no videos with real caption metadata were found.');return unique;}finally{await page.close();}}
async function collectTikTokTrends(limit){let creativeError=null;try{const page=await newPage('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en');try{await page.waitForTimeout(3000);const rows=page.locator('a[href*="/hashtag/"], a[href*="/trends/"], a[href*="/trend/"]');const count=Math.min(await rows.count(),Math.max(limit*3,limit)),out=[];for(let i=0;i<count&&out.length<limit;i++){const row=rows.nth(i),href=await row.getAttribute('href').catch(()=>null);if(!href)continue;const raw=(await row.innerText().catch(()=>'' )).replace(/\n+/g,' · ').trim();const slug=trendSlug(href);const label=hasMeaningfulText(slug)?slug:(extractHashtags(raw,1)[0]||'');if(!hasMeaningfulText(label))continue;const url=href.startsWith('http')?href:`https://ads.tiktok.com${href}`;out.push({id:stableId('TikTok',url,label),platform:'TikTok',author:'TikTok Creative Center',url,content:`#${label.replace(/\s+/g,'')}`,published:null,views:null,likes:null,provenance:'Local Chrome browser · TikTok Creative Center trends'});}if(!out.length){const body=await page.locator('body').innerText().catch(()=>'' );for(const tag of extractHashtags(body,limit)){if(!hasMeaningfulText(tag))continue;const url=`https://www.tiktok.com/search?q=${encodeURIComponent(tag)}`;out.push({id:stableId('TikTok',url,tag),platform:'TikTok',author:'TikTok Creative Center',url,content:`#${tag}`,published:null,views:null,likes:null,provenance:'Local Chrome browser · TikTok Creative Center hashtag fallback'});}}if(out.length)return out;creativeError=new Error('Creative Center loaded but no real trend labels were extractable.');}finally{await page.close();}}catch(error){creativeError=error;}try{return await collectTikTokExplore(limit,1);}catch(fallbackError){const primary=creativeError instanceof Error?creativeError.message:String(creativeError||'unknown Creative Center failure');const fallback=fallbackError instanceof Error?fallbackError.message:String(fallbackError);throw new Error(`Creative Center unavailable (${primary}); TikTok Explore fallback also failed (${fallback}).`);}}

async function collectAll(input={}){
  if(running)throw new Error('A browser scan is already running.');running=true;lastError=null;
  try{
    const active=normalizeConfig({...config,...input}),evidence=[],errors=[],sourceCounts={};
    const add=(source,rows)=>{evidence.push(...rows);sourceCounts[source]=(sourceCounts[source]||0)+rows.length;};
    if(active.scanXExplore)try{add('X Trending',await collectXExplore(active.resultsPerQuery));}catch(e){errors.push(`X Explore: ${e.message}`);}
    if(active.scanXHome)try{add('X Home',await collectXHome(active.maxFeedItems,active.scrollPasses));}catch(e){errors.push(`X Home sample: ${e.message}`);}
    for(const account of active.xAccounts.slice(0,25))try{add('X Account Search',await collectXQuery(`from:${account} -filter:replies`,active.resultsPerQuery));}catch(e){errors.push(`X @${account}: ${e.message}`);}
    for(const keyword of active.keywords.slice(0,20))try{add('X Keyword Search',await collectXQuery(`"${keyword}" -filter:replies`,active.resultsPerQuery));}catch(e){errors.push(`X ${keyword}: ${e.message}`);}
    if(active.scanTikTokTrends)try{const trends=await collectTikTokTrends(active.resultsPerQuery*2);add('TikTok Trending',trends);const seeds=trends.map((x)=>sanitizeTopic(x.content.replace(/^#/,'').split('·')[0])).filter(hasMeaningfulText).slice(0,active.maxTrendQueries);for(const topic of seeds)try{add('TikTok Trend Search',await collectTikTokSearch(topic,active.resultsPerQuery));}catch(e){errors.push(`TikTok ${topic}: ${e.message}`);}}catch(e){errors.push(`TikTok trends: ${e.message}`);}
    if(active.scanTikTokExplore)try{add('TikTok Explore',await collectTikTokExplore(active.maxFeedItems,active.scrollPasses));}catch(e){errors.push(`TikTok Explore sample: ${e.message}`);}
    for(const keyword of active.keywords.slice(0,active.maxTrendQueries))try{add('TikTok Keyword Search',await collectTikTokSearch(keyword,active.resultsPerQuery));}catch(e){errors.push(`TikTok ${keyword}: ${e.message}`);}
    let topics=inferTopics(evidence,Date.now(),active.inferredTopicSearches);
    for(const topic of topics.slice(0,active.inferredTopicSearches)){try{add('X Corroboration',await collectXQuery(`"${topic.topic}" -filter:replies`,active.resultsPerQuery));}catch(e){errors.push(`X inferred ${topic.topic}: ${e.message}`);}try{add('TikTok Corroboration',await collectTikTokSearch(topic.topic,active.resultsPerQuery));}catch(e){errors.push(`TikTok inferred ${topic.topic}: ${e.message}`);}}
    const result=dedupeEvidence(evidence);topics=inferTopics(result,Date.now(),10);lastRun=Date.now();lastCount=result.length;lastTopics=topics;lastError=errors.length?errors.join(' | '):null;lastAudit={sourceCounts,collected:evidence.length,uniqueEvidence:result.length,inferredTopics:topics.length,errors:errors.length};return{evidence:result,errors,inferredTopics:topics,audit:lastAudit,at:lastRun,config:active};
  }finally{running=false;}
}
function scheduleNext(){clearTimeout(scheduleTimer);nextScheduledRun=null;if(!config.enabled)return;const delay=config.intervalMinutes*60000;nextScheduledRun=Date.now()+delay;scheduleTimer=setTimeout(async()=>{nextScheduledRun=null;try{const result=await collectAll(config);queueEvidence(result.evidence);}catch(error){lastError=error instanceof Error?error.message:String(error);}finally{scheduleNext();}},delay);scheduleTimer.unref?.();}
function status(){return{ok:true,service:'front-browser-bridge',version:8,running,lastRun,lastCount,lastError,lastTopics,lastAudit,config,pendingCount:pendingEvidence.length,nextScheduledRun,loginBrowser:systemChrome?'system-chrome':'unavailable',scanConnection:browserConnection?.isConnected?.()?'attached':'waiting-for-front-chrome',cdpUrl};}

const server=http.createServer(async(req,res)=>{if(!originAllowed(req))return json(req,res,403,{error:'Origin not allowed.'});if(req.method==='OPTIONS')return json(req,res,204,{});const url=new URL(req.url||'/',`http://${HOST}:${PORT}`);try{if(req.method==='GET'&&url.pathname==='/health')return json(req,res,200,status());if(req.method==='GET'&&url.pathname==='/config')return json(req,res,200,config);if(req.method==='GET'&&url.pathname==='/pending')return json(req,res,200,{evidence:pendingEvidence.slice(-250),count:pendingEvidence.length,lastRun,lastTopics,lastAudit});if(req.method==='POST'&&url.pathname==='/ack'){let body='';for await(const chunk of req)body+=chunk;const parsed=JSON.parse(body||'{}');return json(req,res,200,{ok:true,removed:ackEvidence(parsed.ids),remaining:pendingEvidence.length});}if(req.method==='POST'&&url.pathname==='/config'){let body='';for await(const chunk of req)body+=chunk;config=normalizeConfig(JSON.parse(body||'{}'));writeJson(configPath,config);scheduleNext();return json(req,res,200,{ok:true,config});}if(req.method==='POST'&&url.pathname==='/scan'){let body='';for await(const chunk of req)body+=chunk;return json(req,res,200,await collectAll(JSON.parse(body||'{}')));}if(req.method==='POST'&&url.pathname==='/open-login'){if(!systemChrome)throw new Error('Google Chrome is required for authenticated X/TikTok scans. Install Chrome, then restart the Front browser bridge.');if(browserConnection?.isConnected?.())await browserConnection.close().catch(()=>{});browserConnection=undefined;context=undefined;stopExistingFrontChrome({dataDir});await new Promise((resolve)=>setTimeout(resolve,700));const opened=openRegularChromeForLogin({dataDir,chromeExecutable:systemChrome,debuggingPort:cdpPort});try{await waitForCdp(opened.cdpUrl,{timeoutMs:12000});}catch(error){throw new Error(`Front Chrome opened, but its local scan connection did not start. Close the Front Chrome window and click Open X + TikTok login once more. ${error instanceof Error?error.message:String(error)}`);}return json(req,res,200,{ok:true,message:'Front Chrome is ready. Sign in to X and TikTok and leave this Front Chrome window open or minimized. Manual and scheduled scans can now use it.',profileDir:opened.profileDir,cdpUrl:opened.cdpUrl});}return json(req,res,404,{error:'Not found'});}catch(error){lastError=error instanceof Error?error.message:String(error);return json(req,res,500,{error:lastError});}});

scheduleNext();server.listen(PORT,HOST,()=>{console.log(`[front-bridge] listening on http://${HOST}:${PORT}`);console.log(`[front-bridge] browser profile: ${profileDir}`);console.log(`[front-bridge] login browser: ${systemChrome||'Google Chrome not found'}`);console.log(`[front-bridge] scan connection: ${cdpUrl}`);console.log(`[front-bridge] scheduled scan: every ${config.intervalMinutes} minute(s) while enabled; pending evidence stays local until Front syncs it`);console.log(`[front-bridge] allowed origins: ${[...allowedOrigins].join(', ')}`);});
