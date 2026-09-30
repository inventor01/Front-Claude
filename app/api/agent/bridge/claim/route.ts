/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { bodyJson, clean, db, noStore, requireBridge } from '@/lib/front-agent-auth';
const parse=(v:string|null,f:any)=>{try{return v?JSON.parse(v):f;}catch{return f;}};
export async function POST(request:Request){
  try{
    const owner=requireBridge(request),body=await bodyJson<any>(request,64_000);
    const bridgeId=clean(body.bridgeId,120);
    if(!bridgeId)return noStore({error:'bridgeId is required.'},400);
    const now=Date.now(),capabilities=body.capabilities&&typeof body.capabilities==='object'?body.capabilities:{};
    await db().prepare(`INSERT INTO bridge_agents(owner,id,label,status,last_seen,capabilities,created)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(owner,id) DO UPDATE SET label=excluded.label,status='ONLINE',last_seen=excluded.last_seen,capabilities=excluded.capabilities`)
      .bind(owner,bridgeId,clean(body.label||'Front local browser bridge',120),'ONLINE',now,JSON.stringify(capabilities),now).run();
    const localBusy=Boolean(body.busy);
    if(localBusy)return noStore({job:null,reason:'LOCAL_SCANNER_BUSY'});
    const leaseId=crypto.randomUUID(),leaseUntil=now+30_000;
    const row=await db().prepare(`UPDATE agent_scroll_jobs SET
      status='CLAIMED',phase='CLAIMED',lease_id=?,lease_expires_at=?,bridge_id=?,
      started=COALESCE(started,?),heartbeat=?,error=NULL
      WHERE owner=? AND id=(
        SELECT id FROM agent_scroll_jobs
        WHERE owner=? AND cancel_requested=0 AND (
          status='QUEUED' OR
          (status IN ('CLAIMED','SCROLLING','ANALYZING','UPLOADING') AND COALESCE(lease_expires_at,0)<?)
        )
        ORDER BY created ASC LIMIT 1
      )
      RETURNING id,status,phase,request_json,request_id,created,started`)
      .bind(leaseId,leaseUntil,bridgeId,now,now,owner,owner,now).first<any>();
    if(!row)return noStore({job:null});
    return noStore({job:{id:row.id,status:row.status,phase:row.phase,requestId:row.request_id,request:parse(row.request_json,{}),created:row.created,started:row.started,leaseId,leaseExpiresAt:leaseUntil}});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
