export * from './narratives-base';

import { verifiedPumpfunMarket } from './pumpfun';

function parseJson<T>(value:string|undefined|null,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
function safeAliases(raw:string){const value=parseJson<unknown>(raw,[]);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}

type LaunchRow={mint:string;name:string;symbol:string|null;seen:number;match_type:string;data:string};
type StoredCoinRow={mint:string;data:string;observed:number};

/**
 * Coin matching is deliberately provenance-first. Front may use DEX market data
 * to price a coin, but a coin can enter narrative_coins only if the same mint is
 * already present in launch_events from PumpPortal subscribeNewToken/create.
 */
export async function matchNarrative(db:D1Database,owner:string,id:string){
 const narrative=await db.prepare('SELECT title,aliases FROM narratives WHERE owner=? AND id=?').bind(owner,id).first<{title:string;aliases:string}>();
 if(!narrative)throw new Error('Narrative not found');
 const launches=(await db.prepare('SELECT mint,name,symbol,seen,match_type,data FROM launch_events WHERE owner=? AND narrative=? ORDER BY seen DESC LIMIT 100').bind(owner,id).all<LaunchRow>()).results;
 const verified=new Set(launches.map((row)=>row.mint));
 const existing=(await db.prepare('SELECT mint,data,observed FROM narrative_coins WHERE owner=? AND narrative=?').bind(owner,id).all<StoredCoinRow>()).results;
 const stale=existing.filter((row)=>!verified.has(row.mint));
 if(stale.length)await db.batch(stale.map((row)=>db.prepare('DELETE FROM narrative_coins WHERE owner=? AND narrative=? AND mint=?').bind(owner,id,row.mint)));
 const existingByMint=new Map(existing.filter((row)=>verified.has(row.mint)).map((row)=>[row.mint,row]));
 let refreshed=0,marketFailures=0;
 for(const launch of launches){
  const previous=existingByMint.get(launch.mint);
  const oldData=parseJson<Record<string,unknown>>(previous?.data,{});
  const freshEnough=previous&&Date.now()-previous.observed<60_000&&oldData.verifiedPumpfun===true;
  let market:Record<string,unknown>={};
  if(freshEnough)market=oldData;
  else{
   try{market=await verifiedPumpfunMarket(launch.mint);refreshed++;}
   catch{marketFailures++;market=oldData;}
  }
  const launchData=parseJson<Record<string,unknown>>(launch.data,{});
  const data={
   ...market,
   mint:launch.mint,
   name:typeof market.name==='string'&&market.name?market.name:launch.name,
   symbol:typeof market.symbol==='string'&&market.symbol?market.symbol:launch.symbol,
   verifiedPumpfun:true,
   verificationSource:'PumpPortal subscribeNewToken create',
   launchSeen:launch.seen,
   matchType:launch.match_type,
   matchScore:typeof launchData.matchScore==='number'?launchData.matchScore:null,
   matchReason:typeof launchData.matchReason==='string'?launchData.matchReason:`${launch.match_type} PumpPortal creation match`,
   narrativeTitle:narrative.title,
  };
  await db.prepare('INSERT INTO narrative_coins(owner,narrative,mint,data,observed) VALUES(?,?,?,?,?) ON CONFLICT(owner,narrative,mint) DO UPDATE SET data=excluded.data,observed=excluded.observed').bind(owner,id,launch.mint,JSON.stringify(data),Date.now()).run();
 }
 return{
  coverage:[{source:'PumpPortal subscribeNewToken/create',ok:true,count:launches.length},{source:'DEX Screener market data for verified mints',ok:marketFailures===0,count:refreshed,error:marketFailures?`${marketFailures} verified mint market lookup(s) unavailable`:undefined}],
  queries:safeAliases(narrative.aliases).slice(0,3),
  verifiedLaunches:launches.length,
  removedUnverified:stale.length,
  refreshed,
 };
}
