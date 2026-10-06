/* eslint-disable @typescript-eslint/no-explicit-any -- persisted journal JSON is validated at the route boundary. */
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { db, noStore, requireService } from '@/lib/front-agent-auth';
import { samePublicOrigin } from '@/lib/request-origin';
import {
 calculateSocialArbHorizons,fetchSocialArbDailyBars,historicalSocialArbBaseline,
 socialArbMarketDataStatus,socialArbMarketDate,
} from '@/lib/social-arb-market-data';

const clean=(value:unknown,max=500)=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,max);
const parse=(value:unknown,fallback:any={})=>{try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}};
const finite=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const HORIZONS=['1','5','20','60'];

async function ownerForWrite(request:Request){
 if(request.headers.get('x-front-commerce-key'))return{owner:requireService(request),service:true};
 const user=await getChatGPTUser();
 if(!user)throw new Response(JSON.stringify({error:'Please sign in to update Social Arb outcomes.'}),{status:401,headers:{'content-type':'application/json'}});
 if(!samePublicOrigin(request))throw new Response(JSON.stringify({error:'Invalid request origin.'}),{status:403,headers:{'content-type':'application/json'}});
 return{owner:user.userId,service:false};
}
function publicRow(row:any){
 const data=parse(row.data,{});
 return{
  researchId:String(row.research_id),signalKey:String(row.signal_key),ticker:String(row.ticker),provider:String(row.provider),
  captured:Number(row.captured)||0,baselinePrice:finite(row.baseline_price),baselineAt:Number(row.baseline_at)||null,
  baselineKind:row.baseline_kind||null,status:String(row.status),lastEvaluated:Number(row.last_evaluated)||null,
  horizons:data.horizons&&typeof data.horizons==='object'?data.horizons:{},
  note:clean(data.note,500)||null,error:clean(data.error,300)||null,
 };
}
async function refreshOne(owner:string,row:any,now:number){
 let baselinePrice=finite(row.baseline_price),baselineAt=Number(row.baseline_at)||null,baselineKind=clean(row.baseline_kind,80)||null;
 let data=parse(row.data,{});
 const configured=socialArbMarketDataStatus().configured;
 if(!configured){
  if(String(row.status)!=='provider-unconfigured'){
   await db().prepare('UPDATE social_arb_outcomes SET status=?,last_evaluated=?,data=? WHERE owner=? AND research_id=?')
    .bind('provider-unconfigured',now,JSON.stringify({...data,note:'Tiingo is not connected; the journal is preserved without fabricating price data.'}),owner,row.research_id).run();
  }
  return{changed:false,status:'provider-unconfigured'};
 }
 if(!baselinePrice){
  try{
   const baseline=await historicalSocialArbBaseline(String(row.ticker),Number(row.captured));
   baselinePrice=baseline.price;baselineAt=baseline.at;baselineKind=baseline.kind;
   data={...data,baselineSourceTimestamp:baseline.sourceTimestamp,baselineBackfilled:true};
  }catch(error){
   const message=clean((error as Error).message,300);
   await db().prepare('UPDATE social_arb_outcomes SET status=?,last_evaluated=?,data=? WHERE owner=? AND research_id=?')
    .bind('baseline-failed',now,JSON.stringify({...data,error:message}),owner,row.research_id).run();
   return{changed:true,status:'baseline-failed'};
  }
 }
 const lastEvaluated=Number(row.last_evaluated)||0;
 if(lastEvaluated&&now-lastEvaluated<12*3600000&&String(row.status)==='tracking')return{changed:false,status:'tracking'};
 const baselineDate=baselineKind==='prior-session-close'
  ?clean(data.baselineSourceTimestamp,20)
  :socialArbMarketDate(Number(row.captured));
 const bars=await fetchSocialArbDailyBars(String(row.ticker),Number(row.captured),now);
 const horizons=calculateSocialArbHorizons(Number(baselinePrice),baselineDate,bars);
 const complete=HORIZONS.every((key)=>(horizons as any)?.[key]?.status==='measured');
 data={...data,horizons,baselineDate,priceMethod:'point-in-time reference with raw EOD follow-up',error:null};
 await db().prepare('UPDATE social_arb_outcomes SET baseline_price=?,baseline_at=?,baseline_kind=?,status=?,last_evaluated=?,data=? WHERE owner=? AND research_id=?')
  .bind(baselinePrice,baselineAt,baselineKind,complete?'complete':'tracking',now,JSON.stringify(data),owner,row.research_id).run();
 return{changed:true,status:complete?'complete':'tracking'};
}

export async function GET(){
 const user=await getChatGPTUser();
 if(!user)return noStore({error:'Please sign in to view Social Arb outcomes.'},401);
 try{
  const rows=await db().prepare('SELECT * FROM social_arb_outcomes WHERE owner=? ORDER BY captured DESC LIMIT 400').bind(user.userId).all<any>();
  const latest=new Map<string,any>();
  for(const row of rows.results)if(!latest.has(String(row.signal_key)))latest.set(String(row.signal_key),publicRow(row));
  const outcomes=[...latest.values()];
  return noStore({
   outcomes,
   provider:socialArbMarketDataStatus(),
   stats:{
    total:outcomes.length,
    tracking:outcomes.filter((row)=>row.status==='tracking').length,
    complete:outcomes.filter((row)=>row.status==='complete').length,
    providerUnconfigured:outcomes.filter((row)=>row.status==='provider-unconfigured').length,
   },
   methodology:'Prices are a point-in-time research journal, not a trading recommendation. Front never backfills a live reference price with future knowledge; missing live baselines use the prior completed session close and are labeled as such.',
  });
 }catch(error){return noStore({error:(error as Error).message},502);}
}

export async function POST(request:Request){
 try{
  const {owner}=await ownerForWrite(request);
  const body=await request.json().catch(()=>({})) as {action?:unknown;limit?:unknown};
  if(body.action!=='refresh')return noStore({error:'Unsupported outcome action.'},400);
  const limit=Math.max(1,Math.min(25,Math.trunc(Number(body.limit)||10)));
  const sql="SELECT * FROM social_arb_outcomes WHERE owner=? AND status IN ('provider-unconfigured','capture-failed','baseline-failed','tracking') ORDER BY CASE WHEN last_evaluated IS NULL THEN 0 ELSE 1 END,last_evaluated ASC,captured ASC LIMIT ?";
  const rows=await db().prepare(sql).bind(owner,limit).all<any>();
  const now=Date.now(),results=[];
  for(const row of rows.results){
   try{results.push({researchId:row.research_id,...await refreshOne(owner,row,now)});}
   catch(error){
    const message=clean((error as Error).message,300);
    await db().prepare('UPDATE social_arb_outcomes SET last_evaluated=?,data=? WHERE owner=? AND research_id=?')
     .bind(now,JSON.stringify({...parse(row.data,{}),error:message}),owner,row.research_id).run();
    results.push({researchId:row.research_id,changed:false,status:'error',error:message});
   }
  }
  return noStore({ok:true,provider:socialArbMarketDataStatus(),checked:rows.results.length,results,at:now});
 }catch(error){if(error instanceof Response)return error;return noStore({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},502);}
}
