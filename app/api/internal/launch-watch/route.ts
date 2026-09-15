import { env } from 'cloudflare:workers';
import { classifyAlias } from '@/lib/coin-matching';
import { matchNarrative } from '@/lib/narratives';
import { coinAliasEligible, isNarrativeLabelJunk, normalizeNarrativeText } from '@/lib/narrative-quality';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function envValue(name:string){return(env as unknown as Record<string,string|undefined>)[name]||'';}
async function internalToken(){const secret=envValue('FRONT_SETTINGS_KEY');if(!secret)return'';const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret}:launch-watch`));return[...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('');}
async function authorized(request:Request){const expected=await internalToken(),supplied=request.headers.get('x-front-internal-key')||'';if(!expected||supplied.length!==expected.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
function safeAliases(raw:string){try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}catch{return[];}}
function safeObject(raw:string|null){try{const value=JSON.parse(raw||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}catch{return{};}}
type ActiveNarrative={id:string;title:string;aliases:string[];lastSeen:number|null;firstSeen:number|null;creatorCount:number;evidenceCount:number};
async function activeNarratives(owner:string):Promise<ActiveNarrative[]>{
 const cutoff=Date.now()-48*3600000;
 const rows=await db().prepare(`SELECT n.id,n.title,n.aliases,MAX(e.last_seen) AS last_seen,MIN(e.first_seen) AS first_seen,COUNT(DISTINCT e.platform || ':' || LOWER(e.author)) AS creator_count,COUNT(DISTINCT e.id) AS evidence_count FROM narratives n LEFT JOIN evidence_links l ON l.owner=n.owner AND l.narrative=n.id LEFT JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE n.owner=? GROUP BY n.id,n.title,n.aliases HAVING (n.id NOT LIKE 'auto:%' OR COALESCE(MAX(e.last_seen),n.created)>?) AND (n.id NOT LIKE 'auto:%' OR COUNT(DISTINCT e.platform || ':' || LOWER(e.author))>=2) ORDER BY COALESCE(MAX(e.last_seen),n.created) DESC LIMIT 1000`).bind(owner,cutoff).all<{id:string;title:string;aliases:string;last_seen:number|null;first_seen:number|null;creator_count:number;evidence_count:number}>();
 return rows.results.flatMap((row)=>{if(isNarrativeLabelJunk(row.title))return[];const titleWords=normalizeNarrativeText(row.title).split(' ').filter(Boolean);if(row.id.startsWith('auto:')&&titleWords.length===1&&Number(row.creator_count)<3)return[];const aliases=[...new Set([row.title,...safeAliases(row.aliases)])].filter((alias)=>coinAliasEligible(alias,row.title));return aliases.length?[{id:row.id,title:row.title,aliases,lastSeen:row.last_seen,firstSeen:row.first_seen,creatorCount:Number(row.creator_count||0),evidenceCount:Number(row.evidence_count||0)}]:[];});
}
function bestNarrativeMatch(name:string,symbol:string|null,narratives:ActiveNarrative[],seen:number){
 let best:(ActiveNarrative&{matchType:string;matchScore:number;matchReason:string;matchedAlias:string})|null=null;const rank:Record<string,number>={exact:3,strong:2,possible:1};
 for(const narrative of narratives){
  const tooEarly=narrative.firstSeen!=null&&seen<narrative.firstSeen-72*3600000;
  for(const alias of narrative.aliases){const hit=classifyAlias(name,symbol,alias,narrative.title);if(!hit)continue;const adjusted=tooEarly&&hit.type!=='possible'?{type:'possible',score:Math.min(.58,hit.score),reason:'wording matches but token predates current narrative evidence'}:hit;if(!best||rank[adjusted.type]>rank[best.matchType]||(rank[adjusted.type]===rank[best.matchType]&&adjusted.score>best.matchScore))best={...narrative,matchType:adjusted.type,matchScore:adjusted.score,matchReason:adjusted.reason,matchedAlias:alias};}
 }
 return best;
}

export async function GET(request:Request){if(!await authorized(request))return json({error:'Unauthorized'},401);const owner=envValue('FRONT_STANDALONE_USER_ID');if(!owner)return json({error:'Standalone owner unavailable'},503);try{return json({narratives:await activeNarratives(owner),at:Date.now()});}catch(error){return json({error:(error as Error).message},500);}}
export async function POST(request:Request){
 if(!await authorized(request))return json({error:'Unauthorized'},401);const owner=envValue('FRONT_STANDALONE_USER_ID');if(!owner)return json({error:'Standalone owner unavailable'},503);
 try{
  const body=await request.json() as {mint?:unknown;name?:unknown;symbol?:unknown;seen?:unknown;raw?:unknown};
  const mint=typeof body.mint==='string'?body.mint.trim():'';
  const name=typeof body.name==='string'?body.name.trim():'';
  const symbol=typeof body.symbol==='string'?body.symbol.trim().slice(0,32):null;
  const raw=body.raw&&typeof body.raw==='object'?body.raw as Record<string,unknown>:{};
  const seen=Number.isFinite(Number(body.seen))?Math.trunc(Number(body.seen)):Date.now();
  if(mint.length<32||mint.length>64)return json({error:'Invalid PumpPortal event mint'},400);

  if(raw.txType==='migrate'){
   const existing=await db().prepare('SELECT name,symbol,narrative,data FROM launch_events WHERE owner=? AND mint=?').bind(owner,mint).first<{name:string;symbol:string|null;narrative:string;data:string|null}>();
   if(!existing)return json({ok:true,event:'migrate',tracked:false});
   const previous=safeObject(existing.data);
   const migration={
    observedAt:seen,
    poolId:typeof raw.poolId==='string'?raw.poolId:null,
    pool:typeof raw.pool==='string'?raw.pool:null,
    marketCapSol:Number.isFinite(Number(raw.marketCapSol))?Number(raw.marketCapSol):null,
    signature:typeof raw.signature==='string'?raw.signature:null,
    raw,
   };
   const stored={...previous,migrationObservedAt:seen,migrationPoolId:migration.poolId,migrationPool:migration.pool,migrationMarketCapSol:migration.marketCapSol,migration};
   await db().prepare('UPDATE launch_events SET data=? WHERE owner=? AND mint=?').bind(JSON.stringify(stored),owner,mint).run();
   return json({ok:true,event:'migrate',tracked:true,mint,name:existing.name,symbol:existing.symbol,narrativeId:existing.narrative,migration});
  }

  if(raw.txType!=='create')return json({error:'Only PumpPortal create and migrate events are accepted.'},400);
  if(!name||name.length>160)return json({error:'Invalid launch event'},400);
  const matched=bestNarrativeMatch(name,symbol,await activeNarratives(owner),seen);
  await db().prepare('INSERT OR IGNORE INTO pump_creation_events(owner,mint,name,symbol,seen,data) VALUES(?,?,?,?,?,?)').bind(owner,mint,name,symbol,seen,JSON.stringify(raw)).run();
  if(!matched||matched.matchType==='possible')return json({ok:true,event:'create',matched:false});
  const stored={matchedAt:Date.now(),firstSeenAt:seen,narrativeDetectedAt:matched.firstSeen,createdAt:null,creationObservedAt:seen,narrativeTitle:matched.title,matchedAlias:matched.matchedAlias,matchScore:matched.matchScore,matchReason:matched.matchReason,verificationSource:'PumpPortal subscribeNewToken create',raw};
  await db().prepare('INSERT INTO launch_events(owner,mint,name,symbol,seen,narrative,match_type,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,seen=MIN(launch_events.seen,excluded.seen),narrative=excluded.narrative,match_type=excluded.match_type,data=launch_events.data').bind(owner,mint,name,symbol,seen,matched.id,matched.matchType,JSON.stringify(stored)).run();
  try{await matchNarrative(db(),owner,matched.id);}catch{}
  return json({ok:true,event:'create',matched:true,narrative:{id:matched.id,title:matched.title},matchType:matched.matchType,matchScore:matched.matchScore});
 }catch(error){return json({error:(error as Error).message},500);}
}
