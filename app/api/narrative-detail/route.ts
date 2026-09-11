import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=(value:string)=>normalize(value).split(' ').filter(Boolean);
const phraseMatch=(text:string,phrase:string)=>(' '+normalize(text)+' ').includes(' '+normalize(phrase)+' ');
function parseJson<T>(value:string|null|undefined,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
function safeAliases(raw:string|null|undefined){const value=parseJson<unknown>(raw,[]);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}

type NarrativeRow={id:string;title:string;aliases:string;created:number};
type EvidenceRow={id:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;last_seen:number;provenance:string;views:number|null;likes:number|null;replies:number|null;reposts:number|null;bookmarks:number|null;quotes:number|null;comments:number|null;shares:number|null;saves:number|null;sound_id:string|null;sound_title:string|null;sound_author:string|null;media_type:string|null;quoted_url:string|null;cover_url:string|null;hashtags:string|null;feed_surface:string|null};
type RelationshipRow={related_key:string;related_title:string;relation:string;score:number;evidence_count:number;author_count:number;platforms:string;observed:number};
type CoinRow={narrative:string;mint:string;data:string;observed:number};
type LaunchRow={mint:string;name:string;symbol:string|null;seen:number;narrative:string|null;match_type:string;data:string};
type SnapshotRow={topic_key:string;topic_title:string;observed:number;tier:string;score:number;momentum:string;creators:number;evidence_count:number;platforms:string;origin_url:string|null;origin_published:number|null;aliases:string};
type RichTopicRow={topic_key:string;observed:number;feed_penetration:number|null;feed_penetration_delta:number|null;feed_penetration_velocity:number|null;aliases:string;sound_signals:string};

function unique(values:string[]){const out=new Map<string,string>();for(const value of values){const clean=value.replace(/\s+/g,' ').trim();const key=normalize(clean);if(key&&!out.has(key))out.set(key,clean);}return[...out.values()];}
function snapshotMatches(row:SnapshotRow,keys:Set<string>){if(keys.has(normalize(row.topic_key))||keys.has(normalize(row.topic_title)))return true;return safeAliases(row.aliases).some(alias=>keys.has(normalize(alias)));}
function richSnapshotMatches(row:RichTopicRow,keys:Set<string>){if(keys.has(normalize(row.topic_key)))return true;return safeAliases(row.aliases).some(alias=>keys.has(normalize(alias)));}
const richEvidenceSelect=`
 er.replies,er.reposts,er.bookmarks,er.quotes,er.comments,er.shares,er.saves,
 er.sound_id,er.sound_title,er.sound_author,er.media_type,er.quoted_url,er.cover_url,er.hashtags,er.feed_surface`;
const richEvidenceJoin=`LEFT JOIN evidence_rich er ON er.owner=e.owner AND er.id=e.id AND er.observed=(SELECT MAX(er2.observed) FROM evidence_rich er2 WHERE er2.owner=e.owner AND er2.id=e.id)`;

export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);
 try{
  const params=new URL(request.url).searchParams;
  const requestedId=(params.get('id')||'').trim();
  const requestedTopic=(params.get('topic')||'').trim().slice(0,120);
  if(!requestedId&&!requestedTopic)return json({error:'Narrative id or topic is required.'},400);

  let narrative:NarrativeRow|null=null;
  if(requestedId){
   narrative=await db().prepare('SELECT id,title,aliases,created FROM narratives WHERE owner=? AND id=?').bind(user.userId,requestedId).first<NarrativeRow>();
   if(!narrative)return json({error:'Narrative not found.'},404);
  }else{
   const rows=await db().prepare('SELECT id,title,aliases,created FROM narratives WHERE owner=? ORDER BY created DESC LIMIT 1000').bind(user.userId).all<NarrativeRow>();
   const key=normalize(requestedTopic);
   narrative=rows.results.find(row=>normalize(row.title)===key||safeAliases(row.aliases).some(alias=>normalize(alias)===key))||null;
  }

  const initialAliases=unique([requestedTopic,narrative?.title||'',...safeAliases(narrative?.aliases)]).filter(Boolean);
  const seedKeys=new Set(initialAliases.map(normalize).filter(Boolean));
  const recentSnapshots=await db().prepare('SELECT topic_key,topic_title,observed,tier,score,momentum,creators,evidence_count,platforms,origin_url,origin_published,aliases FROM topic_snapshots WHERE owner=? AND observed>? ORDER BY observed DESC LIMIT 4000').bind(user.userId,Date.now()-14*86400000).all<SnapshotRow>();
  const snapshotRows=[...recentSnapshots.results].reverse();
  let snapshots=snapshotRows.filter(row=>snapshotMatches(row,seedKeys));
  if(!snapshots.length&&requestedTopic){const key=normalize(requestedTopic);snapshots=snapshotRows.filter(row=>normalize(row.topic_key)===key||normalize(row.topic_title)===key);}
  const latest=snapshots.at(-1)||null;
  const aliases=unique([narrative?.title||'',...safeAliases(narrative?.aliases),latest?.topic_title||'',...safeAliases(latest?.aliases),requestedTopic]).filter(Boolean);
  const matchAliases=aliases.filter(alias=>words(alias).length>0).slice(0,24);
  const richKeys=new Set(aliases.map(normalize).filter(Boolean));
  let richSnapshots:RichTopicRow[]=[];
  try{
   const rows=await db().prepare('SELECT topic_key,observed,feed_penetration,feed_penetration_delta,feed_penetration_velocity,aliases,sound_signals FROM topic_rich_snapshots WHERE owner=? AND observed>? ORDER BY observed ASC LIMIT 4000').bind(user.userId,Date.now()-14*86400000).all<RichTopicRow>();
   richSnapshots=rows.results.filter(row=>richSnapshotMatches(row,richKeys));
  }catch{richSnapshots=[];}
  const latestRich=richSnapshots.at(-1)||null;

  let evidence:EvidenceRow[]=[];
  if(narrative){
   const linked=await db().prepare(`SELECT e.id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,e.provenance,
    (SELECT o.views FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS views,
    (SELECT o.likes FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS likes,
    ${richEvidenceSelect}
    FROM evidence_links l JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence
    ${richEvidenceJoin}
    WHERE l.owner=? AND l.narrative=? ORDER BY COALESCE(e.published,e.first_seen) ASC LIMIT 80`).bind(user.userId,narrative.id).all<EvidenceRow>();
   evidence=linked.results;
  }else if(matchAliases.length){
   const recent=await db().prepare(`SELECT e.id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,e.provenance,
    (SELECT o.views FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS views,
    (SELECT o.likes FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS likes,
    ${richEvidenceSelect}
    FROM evidence e ${richEvidenceJoin}
    WHERE e.owner=? AND e.last_seen>? ORDER BY e.last_seen DESC LIMIT 2000`).bind(user.userId,Date.now()-7*86400000).all<EvidenceRow>();
   evidence=recent.results.filter(row=>matchAliases.some(alias=>phraseMatch(row.content,alias))).sort((a,b)=>(a.published||a.first_seen)-(b.published||b.first_seen)).slice(0,80);
  }

  let relationships:RelationshipRow[]=[];
  let coins:CoinRow[]=[];
  let launches:LaunchRow[]=[];
  if(narrative){
   try{relationships=(await db().prepare('SELECT related_key,related_title,relation,score,evidence_count,author_count,platforms,observed FROM narrative_relationships WHERE owner=? AND narrative=? ORDER BY score DESC,observed DESC LIMIT 20').bind(user.userId,narrative.id).all<RelationshipRow>()).results;}catch{relationships=[];}
   coins=(await db().prepare('SELECT narrative,mint,data,observed FROM narrative_coins WHERE owner=? AND narrative=? ORDER BY observed DESC LIMIT 50').bind(user.userId,narrative.id).all<CoinRow>()).results;
   launches=(await db().prepare('SELECT mint,name,symbol,seen,narrative,match_type,data FROM launch_events WHERE owner=? AND narrative=? ORDER BY seen ASC LIMIT 100').bind(user.userId,narrative.id).all<LaunchRow>()).results;
  }

  const detectedCandidates=[narrative?.created||null,...snapshots.map(row=>row.observed)].filter((v):v is number=>typeof v==='number'&&v>0);
  const detectedAt=detectedCandidates.length?Math.min(...detectedCandidates):null;
  const evidenceTimes=evidence.map(row=>row.published||row.first_seen).filter((v):v is number=>Number.isFinite(v)&&v>0);
  const earliestEvidenceAt=evidenceTimes.length?Math.min(...evidenceTimes):latest?.origin_published||null;
  const firstLaunchAt=launches.length?launches[0].seen:null;
  const leadMs=detectedAt&&firstLaunchAt?firstLaunchAt-detectedAt:null;

  return json({
   narrative:{id:narrative?.id||null,title:narrative?.title||latest?.topic_title||requestedTopic,aliases,detectedAt,promotedAt:narrative?.created||null,earliestEvidenceAt},
   latest:latest?{key:latest.topic_key,title:latest.topic_title,observed:latest.observed,tier:latest.tier,score:latest.score,momentum:parseJson(latest.momentum,{}),creators:latest.creators,evidenceCount:latest.evidence_count,platforms:parseJson<string[]>(latest.platforms,[]),origin:latest.origin_url?{url:latest.origin_url,published:latest.origin_published}:null,feedPenetration:latestRich?.feed_penetration??null,feedPenetrationDelta:latestRich?.feed_penetration_delta??null,feedPenetrationVelocity:latestRich?.feed_penetration_velocity??null,soundSignals:parseJson(latestRich?.sound_signals,[])}:null,
   snapshots:snapshots.slice(-48).map(row=>({observed:row.observed,tier:row.tier,score:row.score,creators:row.creators,evidenceCount:row.evidence_count,platforms:parseJson<string[]>(row.platforms,[]),momentum:parseJson(row.momentum,{})})),
   feedHistory:richSnapshots.slice(-48).map(row=>({observed:row.observed,feedPenetration:row.feed_penetration,feedPenetrationDelta:row.feed_penetration_delta,feedPenetrationVelocity:row.feed_penetration_velocity})),
   evidence:evidence.slice(0,20).map(row=>({...row,hashtags:parseJson<string[]>(row.hashtags,[])})),
   relationships:relationships.map(row=>({...row,platforms:parseJson<string[]>(row.platforms,[])})),
   coins:coins.map(row=>({...row,data:parseJson(row.data,{})})),
   launches:launches.map(row=>({...row,data:parseJson(row.data,{})})),
   edge:{detectedAt,firstLaunchAt,leadMs,status:firstLaunchAt==null?'waiting':leadMs!=null&&leadMs>0?'before-launch':leadMs!=null&&leadMs<0?'after-launch':'same-time'},
   note:'Front detection time is the earliest stored topic snapshot or Radar creation time. Earliest evidence is the earliest sampled evidence Front has, not a guarantee of the absolute first internet post. For You penetration and engagement fields are shown only when the platform exposed them during collection.',
   at:Date.now(),
  });
 }catch(error){return json({error:(error as Error).message},500);}
}