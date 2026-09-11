import { getChatGPTUser } from '@/app/chatgpt-auth';
import { matchNarrative, narrativeFeed, saveEvidence, type Evidence } from '@/lib/narratives';
import { samePublicOrigin } from '@/lib/request-origin';
import { env } from 'cloudflare:workers';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const db = () => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
function asMetric(value: unknown) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null; }
function asTimestamp(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; }
function safeUrl(platform: 'X' | 'TikTok', raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL; try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const allowed = platform === 'X' ? new Set(['x.com','www.x.com','twitter.com','www.twitter.com']) : new Set(['tiktok.com','www.tiktok.com','ads.tiktok.com']);
  if (!allowed.has(host)) return null; url.hash = ''; return url.toString();
}
function evidenceFrom(value: unknown): Evidence | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const platform = row.platform === 'X' || row.platform === 'TikTok' ? row.platform : null; if (!platform) return null;
  const url = safeUrl(platform,row.url); const content = typeof row.content === 'string' ? row.content.replace(/\s+/g,' ').trim().slice(0,8000) : ''; const author = typeof row.author === 'string' ? row.author.trim().slice(0,120) : ''; const id = typeof row.id === 'string' ? row.id.trim().slice(0,180) : '';
  if (!url || !content || !author || !id) return null;
  const provenanceRaw = typeof row.provenance === 'string' ? row.provenance.trim() : '';
  return {id,platform,author,url,content,published:asTimestamp(row.published),views:asMetric(row.views),likes:asMetric(row.likes),provenance:(provenanceRaw||`${platform} local browser bridge`).slice(0,300)};
}
function normalizedNarrativeId(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function narrativeKey(value:unknown){if(typeof value!=='string')return null;const clean=value.replace(/^#/,'').replace(/\s+/g,' ').trim().slice(0,80);const normalized=normalizedNarrativeId(clean);if(normalized.length<2||/^(trending|viral|news|meme|memes|fyp|for you)$/i.test(clean))return null;return clean;}
function trendNarrativeKey(row:Evidence){if(!/X Explore|TikTok Creative Center|TikTok Explore fallback/i.test(row.provenance))return null;return narrativeKey(row.content.split('·')[0]);}
type InferredTopicInput={topic?:unknown;evidenceCount?:unknown;authorCount?:unknown;corroborated?:unknown};
function inferredKeys(value:unknown){if(!Array.isArray(value))return[];const out:string[]=[];for(const raw of value.slice(0,20)){if(!raw||typeof raw!=='object')continue;const row=raw as InferredTopicInput;if(row.corroborated!==true||Number(row.evidenceCount)<2||Number(row.authorCount)<2)continue;const key=narrativeKey(row.topic);if(key&&!out.some((x)=>normalizedNarrativeId(x)===normalizedNarrativeId(key)))out.push(key);}return out;}
async function ensureNarrative(owner:string,key:string,at:number){const normalized=normalizedNarrativeId(key);await db().prepare('INSERT INTO narratives(owner,id,title,aliases,created) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(owner,`auto:${normalized}`,key,JSON.stringify([key]),at).run();}

export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Please sign in to save browser evidence.'},401);if(!samePublicOrigin(request))return json({error:'Invalid request origin.'},403);
  try{
    const body=await request.json() as {evidence?:unknown[];inferredTopics?:unknown};
    if(!Array.isArray(body.evidence))return json({error:'Evidence must be an array.'},400);if(body.evidence.length>250)return json({error:'A browser batch is limited to 250 evidence records.'},400);
    const accepted=body.evidence.map(evidenceFrom).filter((row):row is Evidence=>Boolean(row));if(!accepted.length&&body.evidence.length)return json({error:'No valid X or TikTok evidence records were supplied.'},400);
    const at=Date.now();const inferred=inferredKeys(body.inferredTopics);
    for(const key of inferred)await ensureNarrative(user.userId,key,at);
    for(const row of accepted){const trendKey=trendNarrativeKey(row);if(trendKey)await ensureNarrative(user.userId,trendKey,at);await saveEvidence(db(),user.userId,row,at);}

    let matchedNarratives=0;
    if(accepted.length){const feed=await narrativeFeed(db(),user.userId);const fresh=feed.cards.filter((card:{lastSeen:number})=>card.lastSeen>=at-2000).slice(0,8);for(const card of fresh){try{await matchNarrative(db(),user.userId,card.id);matchedNarratives+=1;}catch{}}}
    const updated=await narrativeFeed(db(),user.userId);const freshNarratives=updated.cards.filter((card:{lastSeen:number})=>card.lastSeen>=at-2000).length;const freshCoins=updated.coins.filter((coin:{observed:number})=>coin.observed>=at-120000).length;
    return json({ok:true,accepted:accepted.length,rejected:body.evidence.length-accepted.length,at,freshNarratives,matchedNarratives,freshCoins,inferredNarratives:inferred.length});
  }catch(error){return json({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},500);}
}
