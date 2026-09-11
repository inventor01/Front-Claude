import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isBroadNarrativeTitle, matchNarrative, narrativeFeed, saveEvidence, type Evidence } from '@/lib/narratives';
import { samePublicOrigin } from '@/lib/request-origin';
import { env } from 'cloudflare:workers';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const db = () => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
const SOCIAL_NOTIFICATION = /\b(?:and\s+\d[\d,.]*\s+others?\s+)?(?:liked|likes|reposted|reposts|quoted|quotes|followed|follows|mentioned|mentions|shared|shares)\s+(?:your|a|this)\s+(?:video|post|tweet|photo|comment|reply)\b/i;
const JUNK_LABEL = /^(?:hashtag|hashtags|caption|video|videos|photo|photos|sound|original sound|user|username|creator|account|profile|quote|reply|replies|repost|reposts|like|likes|bookmark|share|shares|view|views|show|show more|more|see more|read more|follow|following|for you|explore|home|trending|trend)$/i;
const NUMERIC_ONLY = /^\s*\d+(?:[.,]\d+)?\s*[KMB]?\s*$/i;
function asMetric(value: unknown) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null; }
function asTimestamp(value: unknown) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; }
function safeUrl(platform: 'X' | 'TikTok', raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL; try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const allowed = platform === 'X' ? new Set(['x.com','www.x.com','twitter.com','www.twitter.com']) : new Set(['tiktok.com','www.tiktok.com','ads.tiktok.com']);
  if (!allowed.has(host)) return null; url.hash = ''; return url.toString();
}
function normalizeLoose(value:string){return value.normalize('NFKC').toLowerCase().replace(/^@/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function obviousJunk(content:string,author:string){
  const clean=content.replace(/\s+/g,' ').trim();
  if(!clean||SOCIAL_NOTIFICATION.test(clean)||JUNK_LABEL.test(clean)||NUMERIC_ONLY.test(clean))return true;
  const normalized=normalizeLoose(clean),authorNormalized=normalizeLoose(author);
  if(authorNormalized&&(normalized===authorNormalized||normalized===`${authorNormalized} ${authorNormalized}`))return true;
  if(/^@?[A-Za-z0-9_.]{2,40}$/.test(clean)&&authorNormalized&&normalizeLoose(clean)===authorNormalized)return true;
  return false;
}
function evidenceFrom(value: unknown): Evidence | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const platform = row.platform === 'X' || row.platform === 'TikTok' ? row.platform : null; if (!platform) return null;
  const url = safeUrl(platform,row.url); const content = typeof row.content === 'string' ? row.content.replace(/\s+/g,' ').trim().slice(0,8000) : ''; const author = typeof row.author === 'string' ? row.author.trim().slice(0,120) : ''; const id = typeof row.id === 'string' ? row.id.trim().slice(0,180) : '';
  if (!url || !content || !author || !id || obviousJunk(content,author)) return null;
  const provenanceRaw = typeof row.provenance === 'string' ? row.provenance.trim() : '';
  return {id,platform,author,url,content,published:asTimestamp(row.published),views:asMetric(row.views),likes:asMetric(row.likes),provenance:(provenanceRaw||`${platform} local browser bridge`).slice(0,300)};
}
function normalizedNarrativeId(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function narrativeKey(value:unknown){if(typeof value!=='string')return null;const clean=value.replace(/^#/,'').replace(/\s+/g,' ').trim().slice(0,80);const normalized=normalizedNarrativeId(clean);if(normalized.length<2||JUNK_LABEL.test(clean)||NUMERIC_ONLY.test(clean)||/^(trending|viral|news|meme|memes|fyp|for you)$/i.test(clean)||isBroadNarrativeTitle(clean))return null;return clean;}

type RelatedContextInput={key?:unknown;title?:unknown;relation?:unknown;score?:unknown;evidenceCount?:unknown;authorCount?:unknown;platforms?:unknown;evidenceIds?:unknown};
type MomentumInput={label?:unknown;score?:unknown;creatorDelta?:unknown;evidenceDelta?:unknown;platformDelta?:unknown;creatorGrowthPct?:unknown;windows?:unknown};
type OriginInput={url?:unknown;published?:unknown;author?:unknown;platform?:unknown;ageMinutes?:unknown;confidence?:unknown;method?:unknown};
type InferredTopicInput={topic?:unknown;key?:unknown;tier?:unknown;aliases?:unknown;evidenceCount?:unknown;authorCount?:unknown;corroborated?:unknown;platforms?:unknown;score?:unknown;momentum?:unknown;originCandidate?:unknown;relatedContexts?:unknown};
type InferredTopic={key:string;title:string;tier:'pre-breakout'|'candidate';aliases:string[];evidenceCount:number;authorCount:number;platforms:string[];score:number;momentum:MomentumInput|null;origin:OriginInput|null;related:{key:string;title:string;relation:string;score:number;evidenceCount:number;authorCount:number;platforms:string[];evidenceIds:string[]}[]};
function inferredTopics(value:unknown){
  if(!Array.isArray(value))return[];
  const out:InferredTopic[]=[];
  for(const raw of value.slice(0,50)){
    if(!raw||typeof raw!=='object')continue;
    const row=raw as InferredTopicInput;
    const key=narrativeKey(row.topic);if(!key)continue;
    const evidenceCount=Math.trunc(Number(row.evidenceCount)),authorCount=Math.trunc(Number(row.authorCount));
    if(evidenceCount<2||authorCount<2)continue;
    const tier=row.tier==='pre-breakout'?'pre-breakout':'candidate';
    if(tier==='candidate'&&row.corroborated!==true)continue;
    const related:InferredTopic['related']=[];
    if(Array.isArray(row.relatedContexts))for(const entry of row.relatedContexts.slice(0,8)){
      if(!entry||typeof entry!=='object')continue;const r=entry as RelatedContextInput;
      const rawTitle=typeof r.title==='string'?r.title.replace(/^#/,'').replace(/\s+/g,' ').trim().slice(0,80):'';const title=rawTitle||null;const relatedKey=typeof r.key==='string'?normalizedNarrativeId(r.key).slice(0,80):title?normalizedNarrativeId(title):'';
      const rc=Math.trunc(Number(r.evidenceCount)),ac=Math.trunc(Number(r.authorCount)),score=Number(r.score);
      const platforms=Array.isArray(r.platforms)?r.platforms.filter((x):x is string=>x==='X'||x==='TikTok').slice(0,2):[];
      const evidenceIds=Array.isArray(r.evidenceIds)?r.evidenceIds.filter((x):x is string=>typeof x==='string'&&x.length<=180).slice(0,8):[];
      if(!title||JUNK_LABEL.test(title)||NUMERIC_ONLY.test(title)||!relatedKey||rc<2||ac<2||!Number.isFinite(score)||relatedKey===normalizedNarrativeId(key))continue;
      related.push({key:relatedKey,title,relation:typeof r.relation==='string'?r.relation.slice(0,50):'repeated-cooccurrence',score,evidenceCount:rc,authorCount:ac,platforms,evidenceIds});
    }
    const aliases=Array.isArray(row.aliases)?row.aliases.filter((x):x is string=>typeof x==='string').map((x)=>x.trim()).filter(Boolean).slice(0,12):[key];
    const platforms=Array.isArray(row.platforms)?row.platforms.filter((x):x is string=>x==='X'||x==='TikTok').slice(0,2):[];
    const score=Number(row.score);
    const momentum=row.momentum&&typeof row.momentum==='object'?row.momentum as MomentumInput:null;
    const origin=row.originCandidate&&typeof row.originCandidate==='object'?row.originCandidate as OriginInput:null;
    if(!out.some((x)=>normalizedNarrativeId(x.key)===normalizedNarrativeId(key)))out.push({key,title:key,tier,aliases,evidenceCount,authorCount,platforms,score:Number.isFinite(score)?score:0,momentum,origin,related});
  }
  return out;
}
async function ensureNarrative(owner:string,topic:InferredTopic,at:number){
  const normalized=normalizedNarrativeId(topic.key),id=`auto:${normalized}`;
  await db().prepare('INSERT INTO narratives(owner,id,title,aliases,created) VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET aliases=excluded.aliases').bind(owner,id,topic.title,JSON.stringify([...new Set([topic.title,...topic.aliases])].slice(0,24)),at).run();
  return id;
}
async function saveRelationships(owner:string,narrative:string,related:InferredTopic['related'],at:number){
  if(!related.length)return;
  const statements=related.map((r)=>db().prepare('INSERT INTO narrative_relationships(owner,narrative,related_key,related_title,relation,score,evidence_count,author_count,platforms,evidence_ids,observed) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,narrative,related_key) DO UPDATE SET related_title=excluded.related_title,relation=excluded.relation,score=excluded.score,evidence_count=excluded.evidence_count,author_count=excluded.author_count,platforms=excluded.platforms,evidence_ids=excluded.evidence_ids,observed=excluded.observed').bind(owner,narrative,r.key,r.title,r.relation,r.score,r.evidenceCount,r.authorCount,JSON.stringify(r.platforms),JSON.stringify(r.evidenceIds),at));
  await db().batch(statements);
}
async function saveTopicSnapshots(owner:string,topics:InferredTopic[],at:number){
  if(!topics.length)return;
  const statements=topics.map((topic)=>db().prepare('INSERT INTO topic_snapshots(owner,topic_key,topic_title,observed,tier,score,momentum,creators,evidence_count,platforms,origin_url,origin_published,aliases) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,topic_key,observed) DO UPDATE SET topic_title=excluded.topic_title,tier=excluded.tier,score=excluded.score,momentum=excluded.momentum,creators=excluded.creators,evidence_count=excluded.evidence_count,platforms=excluded.platforms,origin_url=excluded.origin_url,origin_published=excluded.origin_published,aliases=excluded.aliases').bind(owner,normalizedNarrativeId(topic.key),topic.title,at,topic.tier,topic.score,JSON.stringify(topic.momentum||{}),topic.authorCount,topic.evidenceCount,JSON.stringify(topic.platforms),typeof topic.origin?.url==='string'?topic.origin.url:null,asTimestamp(topic.origin?.published),JSON.stringify(topic.aliases)));
  await db().batch(statements);
}
async function queueCoinMatches(owner:string,narratives:string[],at:number){
  if(!narratives.length)return;
  await db().batch(narratives.map((id)=>db().prepare("INSERT INTO coin_match_queue(owner,narrative,queued,attempts,last_error,status) VALUES(?,?,?,0,NULL,'queued') ON CONFLICT(owner,narrative) DO UPDATE SET queued=excluded.queued,status='queued'").bind(owner,id,at)));
}
async function processCoinQueue(owner:string,limit=8){
  const queued=await db().prepare("SELECT narrative FROM coin_match_queue WHERE owner=? AND status='queued' ORDER BY queued ASC LIMIT ?").bind(owner,limit).all<{narrative:string}>();
  let matched=0,failed=0;
  for(const row of queued.results){
    await db().prepare("UPDATE coin_match_queue SET status='running',attempts=attempts+1 WHERE owner=? AND narrative=?").bind(owner,row.narrative).run();
    try{await matchNarrative(db(),owner,row.narrative);await db().prepare("UPDATE coin_match_queue SET status='done',last_error=NULL WHERE owner=? AND narrative=?").bind(owner,row.narrative).run();matched++;}
    catch(error){await db().prepare("UPDATE coin_match_queue SET status='queued',last_error=? WHERE owner=? AND narrative=?").bind(String((error as Error).message).slice(0,300),owner,row.narrative).run();failed++;}
  }
  return{processed:queued.results.length,matched,failed};
}

export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Please sign in to save browser evidence.'},401);if(!samePublicOrigin(request))return json({error:'Invalid request origin.'},403);
  try{
    const body=await request.json() as {evidence?:unknown[];inferredTopics?:unknown};
    if(!Array.isArray(body.evidence))return json({error:'Evidence must be an array.'},400);if(body.evidence.length>250)return json({error:'A browser batch is limited to 250 evidence records.'},400);
    const accepted=body.evidence.map(evidenceFrom).filter((row):row is Evidence=>Boolean(row));if(!accepted.length&&body.evidence.length)return json({error:'No valid X or TikTok evidence records were supplied.'},400);
    const at=Date.now(),inferred=inferredTopics(body.inferredTopics);
    await saveTopicSnapshots(user.userId,inferred,at);
    const promotedIds:string[]=[];
    for(const topic of inferred){
      if(topic.tier==='pre-breakout')continue;
      const id=await ensureNarrative(user.userId,topic,at);promotedIds.push(id);await saveRelationships(user.userId,id,topic.related,at);
    }
    for(const row of accepted)await saveEvidence(db(),user.userId,row,at);
    await queueCoinMatches(user.userId,promotedIds,at);
    const queue=await processCoinQueue(user.userId,8);
    const updated=await narrativeFeed(db(),user.userId,{limit:100});const freshNarratives=updated.cards.filter((card:{lastSeen:number})=>card.lastSeen>=at-2000).length;const freshCoins=updated.coins.filter((coin:{observed:number})=>coin.observed>=at-120000).length;
    return json({ok:true,accepted:accepted.length,rejected:body.evidence.length-accepted.length,at,freshNarratives,matchedNarratives:queue.matched,freshCoins,inferredNarratives:promotedIds.length,preBreakout:inferred.filter((x)=>x.tier==='pre-breakout').length,relationshipsSaved:inferred.reduce((sum,x)=>sum+x.related.length,0),coinQueue:queue});
  }catch(error){return json({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},500);}
}
