/* eslint-disable @typescript-eslint/no-explicit-any -- persisted capability JSON is validated before exposure. */
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { db, noStore } from '@/lib/front-agent-auth';

function parse(value:unknown){try{return typeof value==='string'?JSON.parse(value):value||{};}catch{return {};}}

export async function GET(){
 const user=await getChatGPTUser();
 if(!user)return noStore({error:'Please sign in to view Front bridge status.'},401);
 try{
  const now=Date.now();
  const bridge=await db().prepare('SELECT id,status,last_seen,capabilities FROM bridge_agents WHERE owner=? ORDER BY last_seen DESC LIMIT 1').bind(user.userId).first<any>();
  const capabilities=parse(bridge?.capabilities);
  const lastSeen=Number(bridge?.last_seen)||null;
  const online=Boolean(lastSeen&&now-lastSeen<45_000);
  const jobs=await db().prepare("SELECT id,caller,status,phase,request_id,created,started,heartbeat FROM agent_scroll_jobs WHERE owner=? AND status IN ('QUEUED','CLAIMED','SCROLLING','ANALYZING','UPLOADING') ORDER BY created ASC LIMIT 10").bind(user.userId).all<any>();
  return noStore({
   bridge:{
    online,lastSeen,status:online?'ONLINE':'OFFLINE',
    scannerReady:Boolean(capabilities?.scannerReady),chromeReady:Boolean(capabilities?.chromeReady),
    authenticatedPlatforms:Array.isArray(capabilities?.authenticatedPlatforms)?capabilities.authenticatedPlatforms:[],
    scannerVersion:capabilities?.localScannerVersion||null,
   },
   queue:{
    activeCount:jobs.results.length,
    active:jobs.results.map((row:any)=>({id:row.id,caller:row.caller,status:row.status,phase:row.phase,requestId:row.request_id,created:Number(row.created)||0,ageMs:Math.max(0,now-Number(row.created||now))})),
   },
   at:now,
  });
 }catch(error){return noStore({error:(error as Error).message},502);}
}
