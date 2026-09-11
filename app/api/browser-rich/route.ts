import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { samePublicOrigin } from '@/lib/request-origin';

const db=()=>{if(!env.DB)throw Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const clean=(value:unknown,max:number)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const metric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.trunc(value):null;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const safeUrl=(value:unknown)=>{try{const u=new URL(String(value));return u.protocol==='https:'?u.href.slice(0,2048):null;}catch{return null;}};
const safeArray=(value:unknown,maxItems:number,maxChars:number)=>Array.isArray(value)?[...new Set(value.map((item)=>clean(item,maxChars)).filter(Boolean))].slice(0,maxItems):[];
const feedSurface=(provenance:string)=>/X For You/i.test(provenance)?'x-for-you':/TikTok For You/i.test(provenance)?'tiktok-for-you':/sentinel/i.test(provenance)?'x-sentinel':/candidate investigation/i.test(provenance)?'candidate-investigation':/origin research/i.test(provenance)?'origin-research':/trend/i.test(provenance)?'trend-seed':null;

type RichEvidence={
 id?:unknown;platform?:unknown;provenance?:unknown;replies?:unknown;reposts?:unknown;bookmarks?:unknown;quotes?:unknown;comments?:unknown;shares?:unknown;saves?:unknown;soundId?:unknown;soundTitle?:unknown;soundAuthor?:unknown;mediaType?:unknown;quotedUrl?:unknown;coverUrl?:unknown;hashtags?:unknown;creatorFollowers?:unknown;outboundUrls?:unknown;relationType?:unknown;relatedVideoId?:unknown;visualHash?:unknown;
};
type RichTopic={key?:unknown;topic?:unknown;feedPenetration?:unknown;feedPenetrationDelta?:unknown;feedPenetrationVelocity?:unknown;aliases?:unknown;soundSignals?:unknown;visualSignals?:unknown;semanticMergeScore?:unknown;semanticMergeReason?:unknown;originCandidate?:unknown};

async function runBatches(statements:D1PreparedStatement[],size=50){
 for(let i=0;i<statements.length;i+=size)await db().batch(statements.slice(i,i+size));
}

export async function GET(r:Request){
 const user=await getChatGPTUser();
 if(!user)return json({error:'Please sign in to use your desk.'},401);
 try{
  const params=new URL(r.url).searchParams;
  const id=clean(params.get('id'),220);
  if(id){
   const rows=await db().prepare('SELECT * FROM evidence_rich WHERE owner=? AND id=? ORDER BY observed DESC LIMIT 100').bind(user.userId,id).all();
   return json({rows:rows.results});
  }
  const [evidence,topics]=await Promise.all([
   db().prepare('SELECT * FROM evidence_rich WHERE owner=? ORDER BY observed DESC LIMIT 250').bind(user.userId).all(),
   db().prepare('SELECT * FROM topic_rich_snapshots WHERE owner=? ORDER BY observed DESC LIMIT 250').bind(user.userId).all(),
  ]);
  return json({evidence:evidence.results,topics:topics.results});
 }catch(e){return json({error:(e as Error).message},502);}
}

export async function POST(r:Request){
 const user=await getChatGPTUser();
 if(!user)return json({error:'Please sign in to use your desk.'},401);
 if(!samePublicOrigin(r))return json({error:'Invalid request origin'},403);
 try{
  const body=JSON.parse(await r.text()) as {evidence?:RichEvidence[];inferredTopics?:RichTopic[]};
  const evidence=Array.isArray(body.evidence)?body.evidence.slice(0,250):[];
  const topics=Array.isArray(body.inferredTopics)?body.inferredTopics.slice(0,60):[];
  const observed=Date.now();
  const evidenceStatements:D1PreparedStatement[]=[];
  for(const item of evidence){
   const id=clean(item.id,220),platform=clean(item.platform,12),provenance=clean(item.provenance,500);
   if(!id||!['X','TikTok'].includes(platform))continue;
   const hashtags=JSON.stringify(safeArray(item.hashtags,30,80));
   const outboundUrls=JSON.stringify((Array.isArray(item.outboundUrls)?item.outboundUrls:[]).map(safeUrl).filter((url):url is string=>Boolean(url)).slice(0,12));
   evidenceStatements.push(db().prepare(`INSERT INTO evidence_rich(owner,id,observed,replies,reposts,bookmarks,quotes,comments,shares,saves,sound_id,sound_title,sound_author,media_type,quoted_url,cover_url,hashtags,feed_surface,creator_followers,outbound_urls,relation_type,related_video_id,visual_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,id,observed) DO UPDATE SET replies=excluded.replies,reposts=excluded.reposts,bookmarks=excluded.bookmarks,quotes=excluded.quotes,comments=excluded.comments,shares=excluded.shares,saves=excluded.saves,sound_id=excluded.sound_id,sound_title=excluded.sound_title,sound_author=excluded.sound_author,media_type=excluded.media_type,quoted_url=excluded.quoted_url,cover_url=excluded.cover_url,hashtags=excluded.hashtags,feed_surface=excluded.feed_surface,creator_followers=excluded.creator_followers,outbound_urls=excluded.outbound_urls,relation_type=excluded.relation_type,related_video_id=excluded.related_video_id,visual_hash=excluded.visual_hash`)
    .bind(user.userId,id,observed,metric(item.replies),metric(item.reposts),metric(item.bookmarks),metric(item.quotes),metric(item.comments),metric(item.shares),metric(item.saves),clean(item.soundId,120)||null,clean(item.soundTitle,240)||null,clean(item.soundAuthor,160)||null,clean(item.mediaType,30)||null,safeUrl(item.quotedUrl),safeUrl(item.coverUrl),hashtags,feedSurface(provenance),metric(item.creatorFollowers),outboundUrls,clean(item.relationType,30)||null,clean(item.relatedVideoId,120)||null,clean(item.visualHash,64)||null));
  }
  const topicStatements:D1PreparedStatement[]=[];
  for(const topic of topics){
   const key=clean(topic.key||topic.topic,180);
   if(!key)continue;
   const aliases=JSON.stringify(safeArray(topic.aliases,24,100));
   const sounds=Array.isArray(topic.soundSignals)?topic.soundSignals.slice(0,8).map((signal)=>{
    const row=signal&&typeof signal==='object'?signal as Record<string,unknown>:{};
    return{soundId:clean(row.soundId,120),title:clean(row.title,240),creators:metric(row.creators),overlap:metric(row.overlap)};
   }).filter((row)=>row.soundId||row.title):[];
   const visuals=Array.isArray(topic.visualSignals)?topic.visualSignals.slice(0,8).map((signal)=>{
    const row=signal&&typeof signal==='object'?signal as Record<string,unknown>:{};
    return{hash:clean(row.hash,64),creators:metric(row.creators),overlap:metric(row.overlap),platforms:safeArray(row.platforms,2,12)};
   }).filter((row)=>row.hash):[];
   const semanticMerge=JSON.stringify({score:finite(topic.semanticMergeScore),reason:clean(topic.semanticMergeReason,80)||null});
   const originResearch=topic.originCandidate&&typeof topic.originCandidate==='object'?JSON.stringify(topic.originCandidate):null;
   topicStatements.push(db().prepare(`INSERT INTO topic_rich_snapshots(owner,topic_key,observed,feed_penetration,feed_penetration_delta,feed_penetration_velocity,aliases,sound_signals,visual_signals,semantic_merge,origin_research)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,topic_key,observed) DO UPDATE SET feed_penetration=excluded.feed_penetration,feed_penetration_delta=excluded.feed_penetration_delta,feed_penetration_velocity=excluded.feed_penetration_velocity,aliases=excluded.aliases,sound_signals=excluded.sound_signals,visual_signals=excluded.visual_signals,semantic_merge=excluded.semantic_merge,origin_research=excluded.origin_research`)
    .bind(user.userId,key,observed,finite(topic.feedPenetration),finite(topic.feedPenetrationDelta),finite(topic.feedPenetrationVelocity),aliases,JSON.stringify(sounds),JSON.stringify(visuals),semanticMerge,originResearch));
  }
  if(evidenceStatements.length)await runBatches(evidenceStatements);
  if(topicStatements.length)await runBatches(topicStatements);
  return json({ok:true,evidenceSaved:evidenceStatements.length,topicsSaved:topicStatements.length,observed});
 }catch(e){
  return json({error:e instanceof SyntaxError?'Invalid request':(e as Error).message},502);
 }
}
