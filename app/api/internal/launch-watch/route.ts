import { env } from 'cloudflare:workers';
import { normalizeLaunchName } from '@/lib/live';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function envValue(name:string){return (env as unknown as Record<string,string|undefined>)[name]||'';}
async function internalToken(){const secret=envValue('FRONT_SETTINGS_KEY');if(!secret)return'';const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret}:launch-watch`));return [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('');}
async function authorized(request:Request){const expected=await internalToken();const supplied=request.headers.get('x-front-internal-key')||'';if(!expected||supplied.length!==expected.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
function safeAliases(raw:string){try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}catch{return[];}}
async function activeNarratives(owner:string){
 const cutoff=Date.now()-48*3600000;
 const rows=await db().prepare(`SELECT n.id,n.title,n.aliases,MAX(e.last_seen) AS last_seen FROM narratives n LEFT JOIN evidence_links l ON l.owner=n.owner AND l.narrative=n.id LEFT JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE n.owner=? GROUP BY n.id,n.title,n.aliases HAVING n.id NOT LIKE 'auto:%' OR COALESCE(MAX(e.last_seen),n.created)>? ORDER BY COALESCE(MAX(e.last_seen),n.created) DESC LIMIT 1000`).bind(owner,cutoff).all<{id:string;title:string;aliases:string;last_seen:number|null}>();
 return rows.results.map((row)=>({id:row.id,title:row.title,aliases:[...new Set([row.title,...safeAliases(row.aliases)])],lastSeen:row.last_seen}));
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
  const target=normalizeLaunchName(name);const narratives=await activeNarratives(owner);const matched=narratives.find((n)=>n.aliases.some((alias)=>normalizeLaunchName(alias)===target));
  if(!matched)return json({ok:true,matched:false});
  const seen=Number.isFinite(Number(body.seen))?Math.trunc(Number(body.seen)):Date.now();
  await db().prepare('INSERT INTO launch_events(owner,mint,name,symbol,seen,narrative,match_type,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,seen=MAX(launch_events.seen,excluded.seen),narrative=excluded.narrative,match_type=excluded.match_type,data=excluded.data').bind(owner,mint,name,symbol,seen,matched.id,'exact-alias',JSON.stringify({narrativeTitle:matched.title,raw:body.raw&&typeof body.raw==='object'?body.raw:null})).run();
  return json({ok:true,matched:true,narrative:{id:matched.id,title:matched.title}});
 }catch(error){return json({error:(error as Error).message},500);}
}
