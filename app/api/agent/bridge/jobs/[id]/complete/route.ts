import { bodyJson, clean, db, noStore, requireBridge } from '@/lib/front-agent-auth';
const terminal=new Set(['COMPLETED','FAILED','CANCELLED']);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=requireBridge(request),{id}=await params,body=await bodyJson<any>(request,512_000);
    const leaseId=clean(body.leaseId,120),bridgeId=clean(body.bridgeId,120),now=Date.now();
    const status=terminal.has(String(body.status))?String(body.status):'COMPLETED';
    const result=body.result&&typeof body.result==='object'?body.result:{};
    const limitations=Array.isArray(body.limitations)?body.limitations.map((x:any)=>clean(x,500)).filter(Boolean).slice(0,30):[];
    const error=clean(body.error,1000)||null;
    const row=await db().prepare(`UPDATE agent_scroll_jobs SET status=?,phase=?,result_json=?,limitations=?,error=?,
      completed=?,heartbeat=?,lease_id=NULL,lease_expires_at=NULL,cancel_requested=CASE WHEN ?='CANCELLED' THEN 1 ELSE cancel_requested END
      WHERE owner=? AND id=? AND lease_id=? AND bridge_id=? RETURNING id,status`)
      .bind(status,status,JSON.stringify(result),JSON.stringify(limitations),error,now,now,status,owner,id,leaseId,bridgeId).first<any>();
    if(!row)return noStore({error:'Scroll job lease is no longer valid.'},409);
    await db().prepare('UPDATE bridge_agents SET status=?,last_seen=? WHERE owner=? AND id=?').bind('ONLINE',now,owner,bridgeId).run();
    return noStore({ok:true,id,status});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
