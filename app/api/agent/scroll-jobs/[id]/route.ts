/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { db, noStore, requireService } from '@/lib/front-agent-auth';
const parse=(v:string|null,f:any)=>{try{return v?JSON.parse(v):f;}catch{return f;}};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=requireService(request),{id}=await params;
    const row=await db().prepare('SELECT * FROM agent_scroll_jobs WHERE owner=? AND id=? LIMIT 1').bind(owner,id).first<any>();
    if(!row)return noStore({error:'Scroll job not found.'},404);
    const evidence=await db().prepare('SELECT payload FROM agent_scroll_evidence WHERE owner=? AND job_id=? ORDER BY updated DESC LIMIT 300').bind(owner,id).all<any>();
    return noStore({
      id:row.id,status:row.status,phase:row.phase,requestId:row.request_id,request:parse(row.request_json,{}),
      bridgeId:row.bridge_id||null,scanId:row.scan_id||null,observedCount:row.observed_count||0,
      platformCounts:parse(row.platform_counts,{}),limitations:parse(row.limitations,[]),error:row.error||null,
      cancelRequested:Boolean(row.cancel_requested),created:row.created,started:row.started,heartbeat:row.heartbeat,completed:row.completed,
      result:parse(row.result_json,null),evidence:evidence.results.map(x=>parse(x.payload,null)).filter(Boolean)
    });
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
