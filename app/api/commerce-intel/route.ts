import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { buildCommerceOpportunity, type CommerceEvidence } from '@/lib/commerce-intelligence';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function parseJson<T>(value:string,fallback:T):T{try{return JSON.parse(value) as T;}catch{return fallback;}}
const clean=(value:string|null|undefined)=>String(value??'').normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,140);

type SnapshotRow={topic_key:string;topic_title:string;observed:number;aliases:string};
type EvidenceRow={id:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;last_seen:number;views:number|null;likes:number|null};

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user)return json({error:'Please sign in.'},401);
  try{
    const params=new URL(request.url).searchParams;
    const q=clean(params.get('q')||'').toLowerCase();
    const limit=Math.max(1,Math.min(50,Math.trunc(Number(params.get('limit')))||20));
    const now=Date.now();
    const since=now-48*3600000;

    const snapshots=await db().prepare(
      `SELECT s.topic_key,s.topic_title,s.observed,s.aliases
       FROM topic_snapshots s
       JOIN (
         SELECT topic_key,MAX(observed) AS observed
         FROM topic_snapshots
         WHERE owner=? AND observed>?
         GROUP BY topic_key
       ) latest
       ON latest.topic_key=s.topic_key AND latest.observed=s.observed
       WHERE s.owner=?
       ORDER BY s.observed DESC
       LIMIT 160`
    ).bind(user.userId,since,user.userId).all<SnapshotRow>();

    const evidence=await db().prepare(
      `SELECT e.id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,
        (SELECT o.views FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS views,
        (SELECT o.likes FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS likes
       FROM evidence e
       WHERE e.owner=? AND e.last_seen>?
       ORDER BY e.last_seen DESC
       LIMIT 4000`
    ).bind(user.userId,since).all<EvidenceRow>();

    const rows:CommerceEvidence[]=evidence.results.map((row)=>({
      id:row.id,platform:row.platform,author:row.author,url:row.url,content:row.content,
      published:row.published,firstSeen:row.first_seen,lastSeen:row.last_seen,
      views:row.views,likes:row.likes
    }));

    const opportunities=snapshots.results
      .map((row)=>buildCommerceOpportunity({
        key:row.topic_key,
        title:clean(row.topic_title)||clean(row.topic_key),
        observed:row.observed,
        aliases:parseJson<string[]>(row.aliases,[]),
        rows,
        now,
      }))
      .filter((item):item is NonNullable<typeof item>=>Boolean(item))
      .filter((item)=>!q||`${item.title} ${item.creativePatterns.join(' ')}`.toLowerCase().includes(q))
      .sort((a,b)=>{
        const rank=(v:string)=>v==='HIGH'?3:v==='MEDIUM'?2:1;
        return rank(b.confidence)-rank(a.confidence)
          ||b.purchaseIntentMentions-a.purchaseIntentMentions
          ||b.creators-a.creators
          ||b.evidenceCount-a.evidenceCount;
      })
      .slice(0,limit);

    return json({
      opportunities,
      diagnostics:{
        activeWindowHours:48,
        topicSnapshots:snapshots.results.length,
        evidenceRows:rows.length,
        returned:opportunities.length,
      },
      contract:{
        role:'commerce intelligence only',
        launchAuthority:false,
        requiresDownstreamVerification:[
          'supplier viability',
          'landed cost',
          'retail price',
          'gross margin',
          'shipping',
          'competitor saturation',
          'refund risk',
          'IP/trademark',
          'regulatory risk'
        ]
      },
      at:now,
    });
  }catch(error){
    return json({error:(error as Error).message},500);
  }
}
