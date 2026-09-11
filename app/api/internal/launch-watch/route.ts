import { env } from 'cloudflare:workers';
import { normalizeLaunchName } from '@/lib/live';
import { matchNarrative } from '@/lib/narratives';
import { coinAliasEligible, isNarrativeLabelJunk, normalizeNarrativeText, narrativeWords, specificNarrativeTerms } from '@/lib/narrative-quality';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function envValue(name:string){return(env as unknown as Record<string,string|undefined>)[name]||'';}
async function internalToken(){const secret=envValue('FRONT_SETTINGS_KEY');if(!secret)return'';const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret}:launch-watch`));return[...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('');}
async function authorized(request:Request){const expected=await internalToken(),supplied=request.headers.get('x-front-internal-key')||'';if(!expected||supplied.length!==expected.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
function safeAliases(raw:string){try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}catch{return[];}}
const COMMON=new Set('the a an and or for to of in on with is are was were this that it its my your our their new official original coin token meme memecoin crypto sol solana pump fun'.split(' '));
const norm=(value:string)=>normalizeLaunchName(value).replace(/\s+/g,' ').trim();
const words=(value:string)=>norm(value).split(' ').filter((word)=>word.length>=3&&!COMMON.has(word));
function overlapScore(a:string,b:string){const left=new Set(words(a)),right=new Set(words(b));if(!left.size||!right.size)return 0;const overlap=[...left].filter((word)=>right.has(word)).length;return overlap/Math.max(1,Math.min(left.size,right.size));}
function classifyAlias(name:string,symbol:string|null,alias:string,narrativeTitle:string){
 if(!coinAliasEligible(alias,narrativeTitle))return null;const target=norm(name),ticker=norm(symbol||''),candidate=norm(alias);if(!target||!candidate)return null;
 const aliasSpecific=specificNarrativeTerms(alias),tokenSpecific=specificNarrativeTerms(`${name} ${symbol||''}`),aliasWordCount=narrativeWords(alias).length,titleWordCount=narrativeWords(narrativeTitle).length;if(!aliasSpecific.length||!tokenSpecific.length)return null;
 // Exact means the coin explicitly names the validated narrative/alias. A
 // single first/last-name fragment cannot create an Exact hit, but a complete
 // multi-word proper name remains valid even if a surname is a common word.
 if(target===candidate||ticker===candidate){if(titleWordCount>=2&&aliasWordCount===1)return null;return{type:'exact',score:1,reason:`exact normalized ${target===candidate?'name':'symbol'} match to validated narrative phrase`};}
 const overlap=overlapScore(`${name} ${symbol||''}`,alias),containment=candidate.length>=5&&(target.includes(candidate)||candidate.includes(target));
 if(containment&&aliasWordCount>=2&&aliasSpecific.length>=1)return{type:'strong',score:.92,reason:'full distinctive narrative phrase contained in token name'};
 if(aliasSpecific.length>=2&&overlap>=.66)return{type:'strong',score:Number((.8+Math.min(.12,overlap*.12)).toFixed(2)),reason:'multiple distinctive narrative words match token name/symbol'};
 if(aliasSpecific.length>=1&&tokenSpecific.length>=1&&overlap>=.5&&candidate.length>=5)return{type:'possible',score:Number((.52+Math.min(.12,overlap*.12)).toFixed(2)),reason:'partial distinctive narrative wording match'};
 return null;
}
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
 try{const body=await request.json() as {mint?:unknown;name?:unknown;symbol?:unknown;seen?:unknown;raw?:unknown};const mint=typeof body.mint==='string'?body.mint.trim():'',name=typeof body.name==='string'?body.name.trim():'',symbol=typeof body.symbol==='string'?body.symbol.trim().slice(0,32):null;if(mint.length<32||mint.length>64||!name||name.length>160)return json({error:'Invalid launch event'},400);const raw=body.raw&&typeof body.raw==='object'?body.raw as Record<string,unknown>:{};if(raw.txType!=='create')return json({error:'Only PumpPortal create events are accepted.'},400);const seen=Number.isFinite(Number(body.seen))?Math.trunc(Number(body.seen)):Date.now();const matched=bestNarrativeMatch(name,symbol,await activeNarratives(owner),seen);if(!matched)return json({ok:true,matched:false});const stored={narrativeTitle:matched.title,matchedAlias:matched.matchedAlias,matchScore:matched.matchScore,matchReason:matched.matchReason,verificationSource:'PumpPortal subscribeNewToken create',raw};await db().prepare('INSERT INTO launch_events(owner,mint,name,symbol,seen,narrative,match_type,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,seen=MIN(launch_events.seen,excluded.seen),narrative=excluded.narrative,match_type=excluded.match_type,data=excluded.data').bind(owner,mint,name,symbol,seen,matched.id,matched.matchType,JSON.stringify(stored)).run();try{await matchNarrative(db(),owner,matched.id);}catch{}return json({ok:true,matched:true,narrative:{id:matched.id,title:matched.title},matchType:matched.matchType,matchScore:matched.matchScore});}catch(error){return json({error:(error as Error).message},500);}
}
