import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { samePublicOrigin } from '@/lib/request-origin';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const clean=(value:unknown,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const metric=(value:unknown,fallback=0)=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback;};
const integer=(value:unknown,fallback=0)=>Math.trunc(metric(value,fallback));
const stableObserved=(value:unknown,now:number)=>{const n=Number(value);return Number.isFinite(n)&&n>=now-7*86400000&&n<=now+5*60000?Math.trunc(n):now;};
const safeArray=(value:unknown,max=20)=>Array.isArray(value)?[...new Set(value.map((item)=>clean(item,120)).filter(Boolean))].slice(0,max):[];
const safeUrl=(value:unknown)=>{try{const u=new URL(String(value));return u.protocol==='https:'?u.href.slice(0,2048):null;}catch{return null;}};
const TICKER=/^[A-Z][A-Z0-9.-]{0,9}$/;

type SecRow={cik:string;name:string;ticker:string;exchange:string|null};
let secCache:{at:number;rows:SecRow[]}|null=null;

function companyCore(value:string){
 return clean(value,220).normalize('NFKC').toLowerCase()
  .replace(/&/g,' and ')
  .replace(/\b(?:incorporated|inc|corporation|corp|company|co|plc|limited|ltd|holdings?|group|class\s+[a-z])\b/g,' ')
  .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
async function loadSecRows(){
 if(secCache&&Date.now()-secCache.at<6*3600000)return secCache.rows;
 const headers={'Accept':'application/json','User-Agent':'Front Social Arbitrage research tool'};
 const rows:SecRow[]=[];
 try{
  const response=await fetch('https://www.sec.gov/files/company_tickers_exchange.json',{headers,signal:AbortSignal.timeout(10000)});
  if(response.ok){
   const data=await response.json() as {fields?:string[];data?:unknown[][]};
   const fields=Array.isArray(data.fields)?data.fields:[];
   const ix={cik:fields.indexOf('cik'),name:fields.indexOf('name'),ticker:fields.indexOf('ticker'),exchange:fields.indexOf('exchange')};
   for(const raw of Array.isArray(data.data)?data.data:[]){
    const ticker=clean(raw[ix.ticker],12).toUpperCase();
    const name=clean(raw[ix.name],180);
    if(!TICKER.test(ticker)||!name)continue;
    rows.push({cik:clean(raw[ix.cik],20),name,ticker,exchange:ix.exchange>=0?clean(raw[ix.exchange],40)||null:null});
   }
  }
 }catch{}
 if(!rows.length){
  try{
   const response=await fetch('https://www.sec.gov/files/company_tickers.json',{headers,signal:AbortSignal.timeout(10000)});
   if(response.ok){
    const data=await response.json() as Record<string,{cik_str?:unknown;ticker?:unknown;title?:unknown}>;
    for(const raw of Object.values(data||{})){
     const ticker=clean(raw?.ticker,12).toUpperCase(),name=clean(raw?.title,180);
     if(TICKER.test(ticker)&&name)rows.push({cik:clean(raw?.cik_str,20),name,ticker,exchange:null});
    }
   }
  }catch{}
 }
 if(rows.length)secCache={at:Date.now(),rows};
 return rows;
}

function exactEntityMatch(entity:string,rows:SecRow[]){
 const core=companyCore(entity);
 if(core.length<3)return null;
 const matches=rows.filter((row)=>companyCore(row.name)===core);
 return matches.length===1?matches[0]:null;
}

function parseEvidence(value:unknown){
 if(!Array.isArray(value))return[];
 const out=[];
 for(const raw of value.slice(0,8)){
  if(!raw||typeof raw!=='object')continue;
  const row=raw as Record<string,unknown>;
  const url=safeUrl(row.url);if(!url)continue;
  out.push({
   id:clean(row.id,180),platform:clean(row.platform,20),author:clean(row.author,120),url,
   content:clean(row.content,1200),published:Number.isFinite(Number(row.published))?Number(row.published):null,
   evidenceType:row.evidenceType==='comment'?'comment':'post',parentUrl:safeUrl(row.parentUrl),
  });
 }
 return out;
}
function safeBehaviors(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 const allowed=new Set(['PURCHASED','PURCHASE_INTENT','REPEAT_PURCHASE','SWITCHING','STOCKOUT','ADOPTION','ABANDONMENT','COMPLAINT','PRICE_RESISTANCE']);
 const out:Record<string,number>={};
 for(const [key,val] of Object.entries(value as Record<string,unknown>))if(allowed.has(key)){const n=integer(val);if(n>0)out[key]=Math.min(n,10000);}
 return out;
}
function safeChange(value:unknown){
 const row=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const finite=(v:unknown)=>Number.isFinite(Number(v))?Math.max(0,Math.min(1000,Number(v))):null;
 return{
  growthMultiple:finite(row.growthMultiple),authorMultiple:finite(row.authorMultiple),commentMultiple:finite(row.commentMultiple),behaviorMultiple:finite(row.behaviorMultiple),
  newToBaseline:row.newToBaseline===true,
 };
}

type IncomingSignal=Record<string,unknown>;
async function normalizeSignal(raw:IncomingSignal,secRows:SecRow[]){
 const key=clean(raw.key,180).normalize('NFKC').toLowerCase();
 const title=clean(raw.title,140),product=clean(raw.product,140)||title,brand=clean(raw.brandCandidate??raw.brand,140)||null;
 if(key.length<3||!title)return null;
 const mappingConfidence=Math.max(0,Math.min(1,Number(raw.mappingConfidence)||0));
 let ticker=clean(raw.ticker,12).toUpperCase().replace(/[^A-Z0-9.-]/g,'')||null;
 let companyName=clean(raw.companyName,180)||null;
 let tickerVerified=false;
 let secMatch:SecRow|null=null;
 if(ticker&&TICKER.test(ticker))secMatch=secRows.find((row)=>row.ticker===ticker)||null;
 if(!secMatch&&!ticker){
  const entity=companyName||brand||'';
  secMatch=entity?exactEntityMatch(entity,secRows):null;
  if(secMatch){ticker=secMatch.ticker;companyName=secMatch.name;}
 }
 if(secMatch){
  tickerVerified=true;
  ticker=secMatch.ticker;
  companyName=secMatch.name;
 }
 const relation=['owner','supplier','retailer','competitor','platform','other'].includes(String(raw.relation))?String(raw.relation):null;
 const materiality=['low','medium','high'].includes(String(raw.materiality))?String(raw.materiality):null;
 const direction=['positive','negative','mixed','unknown'].includes(String(raw.direction))?String(raw.direction):'unknown';
 const mappingStatus=tickerVerified
  ? (relation==='owner'?'ticker-verified-owner-hypothesis':'ticker-verified')
  : ticker||companyName?'company-hypothesis':'unmapped';
 const behaviors=safeBehaviors(raw.behaviors);
 const change=safeChange(raw.change);
 const evidence=parseEvidence(raw.evidence);
 const platforms=safeArray(raw.platforms,6).filter((p)=>['X','TikTok','Instagram','Reddit','YouTube'].includes(p));
 const score=Math.max(0,Math.min(100,metric(raw.score)));
 const status=['WATCH','EARLY','RISING','HIGH_SIGNAL'].includes(String(raw.status))?String(raw.status):score>=64?'RISING':score>=45?'EARLY':'WATCH';
 return{
  key,title,product,brand,companyName,ticker,relation,direction,materiality,mappingStatus,tickerVerified,
  mappingConfidence,score,status,authorCount:integer(raw.authorCount),commenterCount:integer(raw.commenterCount),independentVoiceCount:integer(raw.independentVoiceCount),evidenceCount:integer(raw.evidenceCount),
  platforms,behaviors,change,thesis:clean(raw.thesis,500)||null,evidence,
  baseline:raw.baseline&&typeof raw.baseline==='object'?raw.baseline:null,
  modelStatus:clean(raw.mappingStatus,60)||null,
  version:integer(raw.version,30),
  informationGap:{status:'not-measured',score:null,marketAwareness:null,note:'Company/ticker identity can be verified here; Wall Street awareness requires a separate evidence check.'},
 };
}

export async function GET(){
 const user=await getChatGPTUser();if(!user)return json({error:'Please sign in to use Social Arb.'},401);
 try{
  const rows=await db().prepare('SELECT * FROM social_arb_observations WHERE owner=? ORDER BY observed DESC LIMIT 600').bind(user.userId).all<Record<string,unknown>>();
  const latest=new Map<string,Record<string,unknown>>();
  const history=new Map<string,{observed:number;score:number;authorCount:number;evidenceCount:number}[]>();
  for(const row of rows.results){
   const key=String(row.signal_key||'');
   if(!latest.has(key))latest.set(key,row);
   const list=history.get(key)||[];
   if(list.length<12)list.push({observed:Number(row.observed)||0,score:Number(row.score)||0,authorCount:Number(row.author_count)||0,evidenceCount:Number(row.evidence_count)||0});
   history.set(key,list);
  }
  const signals=[...latest.values()].map((row)=>{
   let data:Record<string,unknown>={};try{data=JSON.parse(String(row.data||'{}'));}catch{}
   return{
    ...data,
    key:String(row.signal_key),title:String(row.title),product:row.product,brandCandidate:row.brand,companyName:row.company_name,ticker:row.ticker,
    relation:row.relation,direction:row.direction,materiality:row.materiality,mappingStatus:row.mapping_status,tickerVerified:Number(row.ticker_verified)===1,
    score:Number(row.score)||0,status:String(row.status),authorCount:Number(row.author_count)||0,evidenceCount:Number(row.evidence_count)||0,
    platforms:JSON.parse(String(row.platforms||'[]')),behaviors:JSON.parse(String(row.behaviors||'{}')),change:JSON.parse(String(row.change_json||'{}')),
    thesis:row.thesis,observed:Number(row.observed)||0,history:history.get(String(row.signal_key))||[],
   };
  }).sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.observed)-Number(a.observed));
  return json({
   signals:signals.slice(0,80),
   stats:{
    total:signals.length,
    highSignal:signals.filter((s)=>s.status==='HIGH_SIGNAL').length,
    rising:signals.filter((s)=>s.status==='RISING').length,
    mapped:signals.filter((s)=>Boolean(s.ticker)).length,
    tickerVerified:signals.filter((s)=>s.tickerVerified===true).length,
   },
   methodology:'Observed social change → product/brand hypothesis → public-company mapping → verification. This is research evidence, not a trading recommendation.',
   at:Date.now(),
  });
 }catch(error){return json({error:(error as Error).message},502);}
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'Please sign in to use Social Arb.'},401);
 if(!samePublicOrigin(request))return json({error:'Invalid request origin.'},403);
 try{
  const body=JSON.parse(await request.text()) as {signals?:unknown[];scanObservedAt?:unknown};
  if(!Array.isArray(body.signals))return json({error:'Social Arb signals must be an array.'},400);
  if(body.signals.length>80)return json({error:'A Social Arb batch is limited to 80 signals.'},400);
  const now=Date.now(),observed=stableObserved(body.scanObservedAt,now);
  const needsSec=body.signals.some((raw)=>raw&&typeof raw==='object'&&(clean((raw as IncomingSignal).ticker,12)||clean((raw as IncomingSignal).companyName,160)||clean((raw as IncomingSignal).brandCandidate,160)));
  const secRows=needsSec?await loadSecRows():[];
  const normalized=[];
  for(const raw of body.signals){
   if(!raw||typeof raw!=='object')continue;
   const signal=await normalizeSignal(raw as IncomingSignal,secRows);
   if(signal)normalized.push(signal);
  }
  const statements:D1PreparedStatement[]=[];
  const mappingStatements:D1PreparedStatement[]=[];
  for(const signal of normalized){
   const data=JSON.stringify({
    evidence:signal.evidence,baseline:signal.baseline,mappingConfidence:signal.mappingConfidence,modelStatus:signal.modelStatus,
    commenterCount:signal.commenterCount,independentVoiceCount:signal.independentVoiceCount,
    version:signal.version,informationGap:signal.informationGap,
   });
   statements.push(db().prepare(`INSERT INTO social_arb_observations(owner,signal_key,observed,title,product,brand,company_name,ticker,relation,direction,materiality,mapping_status,ticker_verified,score,status,author_count,evidence_count,platforms,behaviors,change_json,thesis,data)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,signal_key,observed) DO UPDATE SET title=excluded.title,product=excluded.product,brand=excluded.brand,company_name=excluded.company_name,ticker=excluded.ticker,relation=excluded.relation,direction=excluded.direction,materiality=excluded.materiality,mapping_status=excluded.mapping_status,ticker_verified=excluded.ticker_verified,score=excluded.score,status=excluded.status,author_count=excluded.author_count,evidence_count=excluded.evidence_count,platforms=excluded.platforms,behaviors=excluded.behaviors,change_json=excluded.change_json,thesis=excluded.thesis,data=excluded.data`)
    .bind(user.userId,signal.key,observed,signal.title,signal.product,signal.brand,signal.companyName,signal.ticker,signal.relation,signal.direction,signal.materiality,signal.mappingStatus,signal.tickerVerified?1:0,signal.score,signal.status,signal.authorCount,signal.evidenceCount,JSON.stringify(signal.platforms),JSON.stringify(signal.behaviors),JSON.stringify(signal.change),signal.thesis,data));
   if(signal.ticker||signal.companyName||signal.brand){
    mappingStatements.push(db().prepare(`INSERT INTO social_arb_company_mappings(owner,signal_key,ticker,company_name,brand,relation,mapping_status,ticker_verified,ownership_verified,confidence,source,updated)
     VALUES(?,?,?,?,?,?,?,?,0,?,?,?)
     ON CONFLICT(owner,signal_key) DO UPDATE SET ticker=excluded.ticker,company_name=excluded.company_name,brand=excluded.brand,relation=excluded.relation,mapping_status=excluded.mapping_status,ticker_verified=excluded.ticker_verified,confidence=excluded.confidence,source=excluded.source,updated=excluded.updated`)
     .bind(user.userId,signal.key,signal.ticker,signal.companyName,signal.brand,signal.relation,signal.mappingStatus,signal.tickerVerified?1:0,signal.mappingConfidence,signal.tickerVerified?'social-arb-engine+sec':'social-arb-engine',now));
   }
  }
  if(statements.length)await db().batch(statements);
  if(mappingStatements.length)await db().batch(mappingStatements);
  return json({
   ok:true,accepted:normalized.length,rejected:body.signals.length-normalized.length,observed,
   mapped:normalized.filter((s)=>Boolean(s.ticker||s.companyName)).length,
   tickerVerified:normalized.filter((s)=>s.tickerVerified).length,
   secDirectoryAvailable:secRows.length>0,
  });
 }catch(error){return json({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},502);}
}
