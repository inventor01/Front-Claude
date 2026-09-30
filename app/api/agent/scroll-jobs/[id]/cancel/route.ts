import { db, noStore, requireService } from '@/lib/front-agent-auth';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=requireService(request),{id}=await params,now=Date.now();
    const result=await db().prepare(`UPDATE agent_scroll_jobs SET cancel_requested=1,
      status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
      phase=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE phase END,
      completed=CASE WHEN status='QUEUED' THEN ? ELSE completed END
      WHERE owner=? AND id=? AND status NOT IN ('COMPLETED','FAILED','CANCELLED','EXPIRED') RETURNING status,phase`).bind(now,owner,id).first<any>();
    if(!result)return noStore({error:'Active scroll job not found.'},404);
    return noStore({id,status:result.status,phase:result.phase,cancelRequested:true});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
