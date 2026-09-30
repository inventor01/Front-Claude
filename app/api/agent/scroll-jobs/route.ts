/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { bodyJson, clean, db, noStore, requireService } from '@/lib/front-agent-auth';

const ALLOWED=new Set(['X','TikTok','Instagram']);
const clamp=(v:unknown,f:number,min:number,max:number)=>Math.max(min,Math.min(max,Math.trunc(Number(v)||f)));
export async function POST(request:Request){
  try{
    const owner=requireService(request);
    const raw=await bodyJson<any>(request);
    const requestId=clean(raw.requestId,180);
    if(!requestId)return noStore({error:'requestId is required.'},400);
    const platforms=[...new Set((Array.isArray(raw.platforms)?raw.platforms:[]).map(String).filter((x:string)=>ALLOWED.has(x)))];
    if(!platforms.length)return noStore({error:'At least one supported platform is required.'},400);
    const keywords=[...new Set((Array.isArray(raw.keywords)?raw.keywords:[]).map((x:any)=>clean(x,100)).filter((x:string)=>x.length>=2))].slice(0,30);
    const objective=clean(raw.objective,2000);
    const normalized={
      mode:['background','scout','deep'].includes(String(raw.mode))?String(raw.mode):'scout',
      platforms,objective,keywords,
      targetUniqueFeedItems:clamp(raw.targetUniqueFeedItems,60,10,180),
      maxSeconds:clamp(raw.maxSeconds,120,20,600),
      maxScrolls:clamp(raw.maxScrolls,48,5,120),
      analysis:{
        transcribeVideos:raw.analysis?.transcribeVideos!==false,
        visualUnderstanding:raw.analysis?.visualUnderstanding!==false,
        contextUnderstanding:raw.analysis?.contextUnderstanding!==false,
        deriveNarratives:raw.analysis?.deriveNarratives!==false
      }
    };
    const now=Date.now(),id=crypto.randomUUID();
    const existing=await db().prepare('SELECT id,status,created FROM agent_scroll_jobs WHERE owner=? AND caller=? AND request_id=? LIMIT 1').bind(owner,'AI_EMPLOYEE_OS',requestId).first<any>();
    if(existing)return noStore({id:existing.id,status:existing.status,deduplicated:true,created:existing.created});
    try{
      await db().prepare(`INSERT INTO agent_scroll_jobs(owner,id,caller,request_id,status,phase,request_json,created)
        VALUES(?,?,?,?,?,?,?,?)`).bind(owner,id,'AI_EMPLOYEE_OS',requestId,'QUEUED','QUEUED',JSON.stringify(normalized),now).run();
    }catch(error){
      const raced=await db().prepare('SELECT id,status,created FROM agent_scroll_jobs WHERE owner=? AND caller=? AND request_id=? LIMIT 1').bind(owner,'AI_EMPLOYEE_OS',requestId).first<any>();
      if(raced)return noStore({id:raced.id,status:raced.status,deduplicated:true,created:raced.created});
      throw error;
    }
    return noStore({id,status:'QUEUED',deduplicated:false,created:now},201);
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
