import { env } from 'cloudflare:workers';
import { normalizeLaunchName } from '@/lib/live';
import { matchNarrative } from '@/lib/narratives';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function envValue(name:string){return (env as unknown as Record<string,string|undefined>)[name]||'';}
async function internalToken(){const secret=envValue('FRONT_SETTINGS_KEY');if(!secret)return'';const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret}:launch-watch`));return [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('');}
async function authorized(request:Request){const expected=await internalToken();const supplied=request.headers.get('x-front-internal-key')||'';if(!expected||supplied.length!==expected.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
function safeAliases(raw:string){try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}catch{return[];}}
const COMMON=new Set('the a an and or for to of in on with is are was were this that it its my your our their new official original coin token meme memecoin crypto sol solana pump fun'.split(' '));
const norm=(value:string)=>normalizeLaunchName(value).replace(/\s+/g,' ').trim();
const words=(value:string)=>norm(value).split(' ').filter((word)=>word.length>=3&&!COMMON.has(word));
function overlapScore(a:string,b:string){const left=new Set(words(a)),right=new Set(words(b));if(!left.size||!right.size)return 0;const overlap=[...left].filter((word)=>right.has(word)).length;return overlap/Math.max(1,Math.min(left.size,right.size));}
function classifyAlias(name:string,symbol:string|null,alias:string){
 const target=norm(name),ticker=norm(symbol||''),candidate=norm(alias);if(!target||!candidate)return null;
 if(target===candidate||ticker===candidate)return{type:'exact',score:1,reason:`exact normalized ${target===candidate?'name':'symbol'} match`};
 const candidateWords=words(candidate),targetWords=words(`${name} ${symbol||''}`),overlap=overlapScore(`${name} ${symbol||''}`,alias);
 const containment=candidate.length>=5&&(target.includes(candidate)||candidate.includes(target));
 if(containment&&candidateWords.length>=1)return{type:'strong',score:.91,reason:'narrative alias contained in token name'};
 if(candidateWords.length>=2&&overlap>=.66)return{type:'strong',score:Number((.78+Math.min(.12,overlap*.12)).toFixed(2)),reason:'multiple distinctive narrative words match token name/symbol'};
 if(candidateWords.length>=1&&targetWords.length>=1&&overlap>=.5&&candidate.length>=5)return{type:'possible',score:Number((.52+Math.min(.12,overlap*.12)).toFixed(2)),reason:'partial distinctive narrative wording match'};
 return null;
}
type ActiveNarrative={id:string;title:string;aliases:string[];lastSeen:number|null};
async function activeNarratives(owner:string):Promise<ActiveNarrative[]>{
 const cutoff=Date.now()-48*3600000;
 const rows=await db().prepare(`SELECT n.id,n.title,n.aliases,MAX(e.last_seen) AS last_seen FROM narratives n LEFT JOIN evidence_links l ON l.owner=n.owner AND l.narrative=n.id LEFT JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE n.owner=? GROUP BY n.id,n.title,n.aliases HAVING n.id NOT LIKE 'auto:%' OR COALESCE(MAX(e.last_seen),n.created)>? ORDER BY COALESCE(MAX(e.last_seen),n.created) DESC LIMIT 1000`).bind(owner,cutoff).all<{id:string;title:string;aliases:string;last_seen:number|null}>();
 return rows.results.map((row)=>({id:row.id,title:row.title,aliases:[...new Set([row.title,...safeAliases(row.aliases)])],lastSeen:row.last_seen}));
}
function bestNarrativeMatch(name:string,symbol:string|null,narratives:ActiveNarrative[]){
 let best:(ActiveNarrative&{matchType:string;matchScore:number;matchReason:string;matchedAlias:string})|null=null;
 const rank:Record<string,number>={exact:3,strong:2,possible:1};
 for(const narrative of narratives)for(const alias of narrative.aliases){const hit=classifyAlias(name,symbol,alias);if(!hit)continue;if(!best||rank[hit.type]>rank[best.matchType]||(rank[hit.type]===rank[best.matchType]&&hit.score>best.matchScore))best={...narrative,matchType:hit.type,matchScore:hit.score,matchReason:hit.reason,matchedAlias:alias};}
 return best;
}

export async function GET(request:Request){
 if(!await authorized(request))return json({error:'Unauthorized'},401);
 const owner=envValue('FRONT_STANDALONE_USER_ID');if(!owner)return json({error:'Standalone owner unavailable'},503);
 try{return json({narratives:await activeNarratives(owner),at:Date.now()});}catch(error){return json({error:(error as Error).message},500);}
}

export async function POST(request:Request){
 if(!await authorized(request))return json({error:'Unauthorized'},401);
 const owner=envValue('FRONT_STANDALONE_USER_ID');if(!owner)return json({error:'Standalone owner unavailable'},503);
 try{
  const body=await request.json() as {mint?:unknown;name?:unknown;symbol?:unknown;seen?:unknown;raw?:unknown};
  const mint=typeof body.mint==='string'?body.mint.trim():'';const name=typeof body.name==='string'?body.name.trim():'';const symbol=typeof body.symbol==='string'?body.symbol.trim().slice(0,32):null;
  if(mint.length<32||mint.length>64||!name||name.length>160)return json({error:'Invalid launch event'},400);
  const raw=body.raw&&typeof body.raw==='object'?body.raw as Record<string,unknown>:{};
  if(raw.txType!=='create')return json({error:'Only PumpPortal create events are accepted.'},400);
  const matched=bestNarrativeMatch(name,symbol,await activeNarratives(owner));
  if(!matched)return json({ok:true,matched:false});
  const seen=Number.isFinite(Number(body.seen))?Math.trunc(Number(body.seen)):Date.now();
  const stored={narrativeTitle:matched.title,matchedAlias:matched.matchedAlias,matchScore:matched.matchScore,matchReason:matched.matchReason,verificationSource:'PumpPortal subscribeNewToken create',raw};
  await db().prepare('INSERT INTO launch_events(owner,mint,name,symbol,seen,narrative,match_type,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,seen=MIN(launch_events.seen,excluded.seen),narrative=excluded.narrative,match_type=excluded.match_type,data=excluded.data').bind(owner,mint,name,symbol,seen,matched.id,matched.matchType,JSON.stringify(stored)).run();
  try{await matchNarrative(db(),owner,matched.id);}catch{/* launch provenance is still safely persisted; market refresh can retry */}
  return json({ok:true,matched:true,narrative:{id:matched.id,title:matched.title},matchType:matched.matchType,matchScore:matched.matchScore});
 }catch(error){return json({error:(error as Error).message},500);}
}
