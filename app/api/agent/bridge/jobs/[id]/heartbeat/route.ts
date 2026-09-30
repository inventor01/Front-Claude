import { bodyJson, clean, db, noStore, requireBridge } from '@/lib/front-agent-auth';
const allowed=new Set(['CLAIMED','SCROLLING','ANALYZING','UPLOADING']);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=requireBridge(request),{id}=await params,body=await bodyJson<any>(request,128_000);
    const leaseId=clean(body.leaseId,120),bridgeId=clean(body.bridgeId,120);
    if(!leaseId||!bridgeId)return noStore({error:'leaseId and bridgeId are required.'},400);
    const now=Date.now(),status=allowed.has(String(body.status))?String(body.status):'SCROLLING';
    const phase=clean(body.phase||status,120);
    const row=await db().prepare(`UPDATE agent_scroll_jobs SET status=?,phase=?,heartbeat=?,lease_expires_at=?,scan_id=COALESCE(?,scan_id),
      observed_count=?,platform_counts=? WHERE owner=? AND id=? AND lease_id=? AND bridge_id=?
      RETURNING cancel_requested,status,phase`)
      .bind(status,phase,now,now+30_000,clean(body.scanId,160)||null,Math.max(0,Math.trunc(Number(body.observedCount)||0)),
        JSON.stringify(body.platformCounts&&typeof body.platformCounts==='object'?body.platformCounts:{}),owner,id,leaseId,bridgeId).first<any>();
    if(!row)return noStore({error:'Scroll job lease is no longer valid.'},409);
    await db().prepare('UPDATE bridge_agents SET status=?,last_seen=?,capabilities=? WHERE owner=? AND id=?')
      .bind('ONLINE',now,JSON.stringify(body.capabilities&&typeof body.capabilities==='object'?body.capabilities:{}),owner,bridgeId).run();
    return noStore({ok:true,cancelRequested:Boolean(row.cancel_requested),status:row.status,phase:row.phase,leaseExpiresAt:now+30_000});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
