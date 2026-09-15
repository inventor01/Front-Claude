export * from './narratives-base';

import { verifiedPumpfunMarket,discoverPumpfunCoins } from './pumpfun';
import { classifyAlias } from './coin-matching';
import { trackCoin } from './coin-intelligence';

function parseJson<T>(value:string|undefined|null,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
function safeAliases(raw:string){const value=parseJson<unknown>(raw,[]);return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.trim().length>1).slice(0,24):[];}

function coinNumberFromRaw(raw:unknown){if(!raw||typeof raw!=='object')return null;const value=(raw as Record<string,unknown>).marketCapSol;return typeof value==='number'&&Number.isFinite(value)?value:null;}

type LaunchRow={mint:string;name:string;symbol:string|null;seen:number;match_type:string;data:string};
type StoredCoinRow={mint:string;data:string;observed:number};

/**
 * Coin matching is deliberately provenance-first. Front may use DEX market data
 * to price a coin. Association requires either an observed PumpPortal create
 * event or an independently labeled direct Pump.fun pool plus a validated phrase.
 */
async function enrichNarrative(db:D1Database,owner:string,id:string){
 const narrative=await db.prepare('SELECT title,aliases,created FROM narratives WHERE owner=? AND id=?').bind(owner,id).first<{title:string;aliases:string;created:number}>();
 if(!narrative)throw new Error('Narrative not found');
 const topic=await db.prepare('SELECT MIN(observed) AS detected FROM topic_snapshots WHERE owner=? AND (LOWER(topic_title)=LOWER(?) OR topic_key=?)').bind(owner,narrative.title,id.replace(/^auto:/,'')).first<{detected:number|null}>();
 const latestTopic=await db.prepare('SELECT tier,momentum FROM topic_snapshots WHERE owner=? AND (LOWER(topic_title)=LOWER(?) OR topic_key=?) ORDER BY observed DESC LIMIT 1').bind(owner,narrative.title,id.replace(/^auto:/,'')).first<{tier:string;momentum:string}>();
 const narrativeMomentum=parseJson<Record<string,unknown>>(latestTopic?.momentum,{});
 const inventory=(await db.prepare('SELECT mint,name,symbol,seen,data FROM pump_creation_events WHERE owner=? AND seen>? ORDER BY seen DESC LIMIT 3000').bind(owner,Date.now()-72*3600000).all<{mint:string;name:string;symbol:string|null;seen:number;data:string}>()).results;
 for(const event of inventory){
  const hits=[narrative.title,...safeAliases(narrative.aliases)].map(alias=>classifyAlias(event.name,event.symbol,alias,narrative.title)).filter(hit=>hit&&hit.type!=='possible').sort((a,b)=>b!.score-a!.score);
  const hit=hits[0];if(!hit)continue;
  await db.prepare('INSERT OR IGNORE INTO launch_events(owner,mint,name,symbol,seen,narrative,match_type,data) VALUES(?,?,?,?,?,?,?,?)').bind(owner,event.mint,event.name,event.symbol,event.seen,id,hit.type,JSON.stringify({matchScore:hit.score,matchReason:hit.reason,creationObservedAt:event.seen,createdAt:null,raw:parseJson(event.data,{})})).run();
 }
 let discoveryError:string|undefined;
 try{
  for(const coin of await discoverPumpfunCoins(narrative.title)){
   const hits=[narrative.title,...safeAliases(narrative.aliases)].map(alias=>classifyAlias(coin.name,coin.symbol,alias,narrative.title)).filter(hit=>hit&&hit.type!=='possible').sort((a,b)=>b!.score-a!.score);const hit=hits[0];if(!hit)continue;
   await db.prepare('INSERT INTO narrative_coin_candidates(owner,narrative,mint,name,symbol,seen,match_type,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,narrative,mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,match_type=excluded.match_type').bind(owner,id,coin.mint,coin.name,coin.symbol,Date.now(),hit.type,JSON.stringify({matchScore:hit.score,matchReason:hit.reason,verificationSource:'DEX Screener direct Pump.fun pool',createdAt:null})).run();
  }
 }catch(error){discoveryError=(error as Error).message;}
 const storedLaunches=(await db.prepare('SELECT mint,name,symbol,seen,match_type,data FROM launch_events WHERE owner=? AND narrative=? ORDER BY seen DESC').bind(owner,id).all<LaunchRow>()).results;
 const candidates=(await db.prepare('SELECT mint,name,symbol,seen,match_type,data FROM narrative_coin_candidates WHERE owner=? AND narrative=?').bind(owner,id).all<LaunchRow>()).results;
 const combined=[...new Map([...candidates,...storedLaunches].map(row=>[row.mint,row])).values()];
 const launches:LaunchRow[]=[];
 for(const launch of combined){
  const hits=[narrative.title,...safeAliases(narrative.aliases)].map(alias=>classifyAlias(launch.name,launch.symbol,alias,narrative.title)).filter(hit=>hit&&hit.type!=='possible').sort((a,b)=>b!.score-a!.score);
  const hit=hits[0];if(!hit){await db.prepare("UPDATE launch_events SET match_type='rejected' WHERE owner=? AND mint=? AND narrative=?").bind(owner,launch.mint,id).run();continue;}
  const data={...parseJson<Record<string,unknown>>(launch.data,{}),matchScore:hit.score,matchReason:hit.reason};
  await db.prepare('UPDATE launch_events SET match_type=?,data=? WHERE owner=? AND mint=? AND narrative=?').bind(hit.type,JSON.stringify(data),owner,launch.mint,id).run();
  launches.push({...launch,match_type:hit.type,data:JSON.stringify(data)});
 }
 const verified=new Set(launches.map((row)=>row.mint));
 const existing=(await db.prepare('SELECT mint,data,observed FROM narrative_coins WHERE owner=? AND narrative=?').bind(owner,id).all<StoredCoinRow>()).results;
 const stale=existing.filter((row)=>!verified.has(row.mint));
 if(stale.length)await db.batch(stale.map((row)=>db.prepare('DELETE FROM narrative_coins WHERE owner=? AND narrative=? AND mint=?').bind(owner,id,row.mint)));
 const existingByMint=new Map(existing.filter((row)=>verified.has(row.mint)).map((row)=>[row.mint,row]));
 let refreshed=0,marketFailures=0;
 for(let offset=0;offset<launches.length;offset+=4){const writes:D1PreparedStatement[]=[];await Promise.all(launches.slice(offset,offset+4).map(async launch=>{
  const previous=existingByMint.get(launch.mint);
  const oldData=parseJson<Record<string,unknown>>(previous?.data,{});
  const freshEnough=previous&&Date.now()-previous.observed<60_000&&oldData.verifiedPumpfun===true&&oldData.trackingVersion===1;
  let market:Record<string,unknown>={};
  if(freshEnough)return;
  else{
   try{market=await verifiedPumpfunMarket(launch.mint);refreshed++;}
   catch{marketFailures++;market={marketCap:null,marketDataStatus:'unavailable'};}
  }
  const launchData=parseJson<Record<string,unknown>>(launch.data,{});
  const now=Date.now();
  const previousState=previous&&!oldData.trackingVersion?{...oldData,firstSeenAt:previous.observed,marketCapAtFirstSeen:oldData.marketCap??null,marketCapAtMatch:null,matchedAt:previous.observed}:oldData;
  const data=trackCoin(previousState,market,{
   narrativeId:id,
   trackingVersion:1,
   narrativeDetectedAt:Math.min(narrative.created,topic?.detected??narrative.created),
   narrativeLifecycle:latestTopic?.tier??null,
   narrativeVelocity:narrativeMomentum.score??null,
   createdAt:typeof launchData.createdAt==='number'?launchData.createdAt:null,
   mint:launch.mint,
   name:typeof market.name==='string'&&market.name?market.name:launch.name,
   symbol:typeof market.symbol==='string'&&market.symbol?market.symbol:launch.symbol,
   verifiedPumpfun:true,
   verificationSource:launchData.verificationSource||'PumpPortal subscribeNewToken create',
   launchSeen:launchData.verificationSource==='DEX Screener direct Pump.fun pool'?null:launch.seen,
   creationObservedAt:launchData.verificationSource==='DEX Screener direct Pump.fun pool'?null:launch.seen,
   firstObservedMarketCapSol:coinNumberFromRaw(launchData.raw),
   matchType:launch.match_type,
   matchScore:typeof launchData.matchScore==='number'?launchData.matchScore:null,
   matchReason:typeof launchData.matchReason==='string'?launchData.matchReason:`${launch.match_type} PumpPortal creation match`,
   narrativeTitle:narrative.title,
  },now);
  writes.push(db.prepare('INSERT INTO narrative_coins(owner,narrative,mint,data,observed) VALUES(?,?,?,?,?) ON CONFLICT(owner,narrative,mint) DO UPDATE SET data=excluded.data,observed=excluded.observed').bind(owner,id,launch.mint,JSON.stringify(data),now),
  db.prepare('INSERT OR IGNORE INTO coin_market_snapshots(owner,narrative,mint,observed,data) VALUES(?,?,?,?,?)').bind(owner,id,launch.mint,now,JSON.stringify(data)));
 }));if(writes.length)await db.batch(writes);}
 return{
  coverage:[{source:'Pump.fun pool discovery',ok:!discoveryError,error:discoveryError},{source:'PumpPortal subscribeNewToken/create',ok:true,count:launches.length},{source:'DEX Screener market data for verified mints',ok:marketFailures===0,count:refreshed,error:marketFailures?`${marketFailures} verified mint market lookup(s) unavailable`:undefined}],
  queries:safeAliases(narrative.aliases).slice(0,3),
  verifiedLaunches:launches.length,
  removedUnverified:stale.length,
  refreshed,
 };
}

const activeMatches=new Map<string,Promise<unknown>>();
export function matchNarrative(db:D1Database,owner:string,id:string){
 const key=owner+':'+id;const active=activeMatches.get(key);if(active)return active;
 const promise=enrichNarrative(db,owner,id).finally(()=>activeMatches.delete(key));activeMatches.set(key,promise);return promise;
}
