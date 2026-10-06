/* eslint-disable @typescript-eslint/no-explicit-any -- D1 queue rows are validated before use. */
import { db, noStore, requireService } from '@/lib/front-agent-auth';

const SOCIAL_ARB_QUEUE_TTL_MS=30*60*1000;
const EXTERNAL_QUEUE_TTL_MS=6*60*60*1000;
const SOCIAL_ARB_ACTIVE_TTL_MS=45*60*1000;
const EXTERNAL_ACTIVE_TTL_MS=8*60*60*1000;

export async function POST(request:Request){
 try{
  const owner=requireService(request),now=Date.now();
  const queued=await db().prepare("SELECT id,caller,created FROM agent_scroll_jobs WHERE owner=? AND status='QUEUED' AND cancel_requested=0 LIMIT 200")
   .bind(owner).all<any>();
  const active=await db().prepare("SELECT id,caller,created,started,heartbeat,lease_expires_at,status FROM agent_scroll_jobs WHERE owner=? AND status IN ('CLAIMED','SCROLLING','ANALYZING','UPLOADING') AND cancel_requested=0 LIMIT 200")
   .bind(owner).all<any>();
  const expiredIds:string[]=[];
  for(const row of queued.results){
   const ttl=row.caller==='FRONT_SOCIAL_ARB'?SOCIAL_ARB_QUEUE_TTL_MS:EXTERNAL_QUEUE_TTL_MS;
   if(now-Number(row.created||0)>ttl)expiredIds.push(String(row.id));
  }
  for(const row of active.results){
   const ttl=row.caller==='FRONT_SOCIAL_ARB'?SOCIAL_ARB_ACTIVE_TTL_MS:EXTERNAL_ACTIVE_TTL_MS;
   const activity=Number(row.heartbeat||row.started||row.created||0);
   const leaseExpired=Number(row.lease_expires_at||0)<now;
   if(leaseExpired&&now-activity>ttl)expiredIds.push(String(row.id));
  }
  let expired=0;
  for(const id of [...new Set(expiredIds)]){
   const result=await db().prepare("UPDATE agent_scroll_jobs SET status='EXPIRED',phase='EXPIRED',cancel_requested=1,completed=?,error=COALESCE(error,'QUEUE_TTL_EXPIRED') WHERE owner=? AND id=? AND status IN ('QUEUED','CLAIMED','SCROLLING','ANALYZING','UPLOADING')")
    .bind(now,owner,id).run();
   expired+=Number(result.meta?.changes||0);
  }
  const offline=await db().prepare("UPDATE bridge_agents SET status='OFFLINE' WHERE owner=? AND status='ONLINE' AND last_seen<?")
   .bind(owner,now-90_000).run();
  return noStore({ok:true,expired,bridgeAgentsMarkedOffline:Number(offline.meta?.changes||0),at:now,policy:{socialArbQueuedMinutes:30,externalQueuedHours:6,socialArbActiveMinutes:45,externalActiveHours:8}});
 }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
