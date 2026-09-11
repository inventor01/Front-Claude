import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function parseJson<T>(value:string,fallback:T):T{try{return JSON.parse(value) as T;}catch{return fallback;}}

type SnapshotRow={topic_key:string;topic_title:string;observed:number;tier:string;score:number;momentum:string;creators:number;evidence_count:number;platforms:string;origin_url:string|null;origin_published:number|null;aliases:string};
type LaunchRow={mint:string;name:string;symbol:string|null;seen:number;narrative:string|null;match_type:string;data:string};

export async function GET(){
 const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);
 try{
  const now=Date.now();
  const activeSince=now-48*3600000;
  const snapshots=await db().prepare(`SELECT s.topic_key,s.topic_title,s.observed,s.tier,s.score,s.momentum,s.creators,s.evidence_count,s.platforms,s.origin_url,s.origin_published,s.aliases FROM topic_snapshots s JOIN (SELECT topic_key,MAX(observed) AS observed FROM topic_snapshots WHERE owner=? AND observed>? GROUP BY topic_key) latest ON latest.topic_key=s.topic_key AND latest.observed=s.observed WHERE s.owner=? ORDER BY s.observed DESC,s.score DESC LIMIT 100`).bind(user.userId,activeSince,user.userId).all<SnapshotRow>();
  const launches=await db().prepare('SELECT mint,name,symbol,seen,narrative,match_type,data FROM launch_events WHERE owner=? ORDER BY seen DESC LIMIT 50').bind(user.userId).all<LaunchRow>();
  const queue=await db().prepare('SELECT status,COUNT(*) AS count FROM coin_match_queue WHERE owner=? GROUP BY status').bind(user.userId).all<{status:string;count:number}>();
  return json({
    topics:snapshots.results.map((row)=>({key:row.topic_key,title:row.topic_title,observed:row.observed,tier:row.tier,score:row.score,momentum:parseJson(row.momentum,{}),creators:row.creators,evidenceCount:row.evidence_count,platforms:parseJson<string[]>(row.platforms,[]),origin:row.origin_url?{url:row.origin_url,published:row.origin_published}:null,aliases:parseJson<string[]>(row.aliases,[])})),
    launches:launches.results.map((row)=>({...row,data:parseJson(row.data,{})})),
    queue:Object.fromEntries(queue.results.map((row)=>[row.status,row.count])),
    at:now,
  });
 }catch(error){return json({error:(error as Error).message},500);}
}