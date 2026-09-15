/** Observations are USD unless explicitly suffixed Sol. Missing data stays null. */
export type CoinMetrics = Record<string, unknown>;
export const coinNumber=(value:unknown):number|null=>value==null||value===''?null:typeof value==='number'||typeof value==='string'?Number.isFinite(Number(value))?Number(value):null:null;
export function coinLinks(mint:string){return{pumpUrl:`https://pump.fun/coin/${encodeURIComponent(mint)}`,axiomUrl:`https://axiom.trade/t/${encodeURIComponent(mint)}`,dexScreenerUrl:`https://dexscreener.com/solana/${encodeURIComponent(mint)}`};}
export function trackCoin(old:CoinMetrics,market:CoinMetrics,identity:CoinMetrics,now=Date.now()):CoinMetrics{
 const current=coinNumber(market.marketCap),first=coinNumber(old.marketCapAtFirstSeen)??current;
 const matchedAt=coinNumber(old.matchedAt)??coinNumber(identity.matchedAt)??now;
 // A later quote must never be presented as the historical quote at match.
 const atMatch=Object.hasOwn(old,'marketCapAtMatch')?coinNumber(old.marketCapAtMatch):matchedAt===now?current:null;
 const peakValues=[coinNumber(old.peakMarketCap),current,first].filter((n):n is number=>n!==null);
 const peak=peakValues.length?Math.max(...peakValues):null;
 const delta=current!==null&&atMatch!==null?current-atMatch:null;
 const change=delta!==null&&atMatch!==null&&atMatch>0?delta/atMatch*100:null;
 const createdAt=coinNumber(identity.createdAt)??coinNumber(old.createdAt);
 const detectedAt=coinNumber(old.narrativeDetectedAt)??coinNumber(identity.narrativeDetectedAt);
 const age=createdAt===null?null:Math.max(0,now-createdAt);
 const buys=coinNumber(market.buys5m),sells=coinNumber(market.sells5m),volume=coinNumber(market.volume5m),liq=coinNumber(market.liquidity),priceChange=coinNumber(market.priceChange5m);
 const tx=buys!==null&&sells!==null?buys+sells:null;
 const previous=coinNumber(old.currentMarketCap),elapsed=now-(coinNumber(old.lastUpdatedAt)??now);
 const acceleration=current!==null&&previous!==null&&previous>0&&elapsed>0?(current/previous-1)*60000/elapsed:null;
 const previousVolume=coinNumber(old.volume5m),volumeAcceleration=volume!==null&&previousVolume!==null&&previousVolume>0?volume/previousVolume-1:null;
 const tractionScore=Math.round(Math.min(100,Math.log10(1+Math.max(0,volume??0))*7+Math.log10(1+Math.max(0,liq??0))*5+Math.min(25,(tx??0)/2)+(buys!==null&&sells!==null&&buys>sells?10:0)));
 const narrativeCooling=/cool|fad|dead/i.test(String(identity.narrativeLifecycle||''));
 const narrativeVelocity=coinNumber(identity.narrativeVelocity);
 let momentumStatus='UNKNOWN';
 if(tx!==null&&volume!==null){
  if(age!==null&&age>86400000&&tx===0&&volume===0)momentumStatus='DEAD';
  else if(((priceChange??0)<-10||narrativeCooling&&(acceleration??0)<0)&&sells!==null&&buys!==null&&sells>buys)momentumStatus='FADING';
  else if(age!==null&&age<120000)momentumStatus='JUST CREATED';
  else if(tractionScore>=80&&!narrativeCooling&&(narrativeVelocity===null||narrativeVelocity>0)&&(priceChange??0)>10&&(volumeAcceleration??0)>0)momentumStatus='HOT';
  else if(tractionScore>=60&&!narrativeCooling&&(acceleration??0)>.02&&buys!==null&&sells!==null&&buys>sells)momentumStatus='BREAKOUT';
  else if(age!==null&&age>86400000&&tractionScore>=50)momentumStatus='LATE';
  else if(tractionScore>=40&&(priceChange??0)>0)momentumStatus='MOVING';
  else momentumStatus='EARLY';
 }
 const score=coinNumber(identity.matchScore)??coinNumber(old.matchScore)??0;
 const opportunityStatus=score<.75?'WEAK MATCH':momentumStatus==='BREAKOUT'||momentumStatus==='HOT'?'BREAKOUT':momentumStatus==='LATE'?'LATE':tx!==null&&tractionScore<25?'LOW TRACTION':age!==null&&age<3600000?'EARLY MATCH':'CONFIRMING';
 return{...old,...market,...identity,...coinLinks(String(identity.mint??old.mint)),firstSeenAt:coinNumber(old.firstSeenAt)??now,matchedAt,createdAt,narrativeDetectedAt:detectedAt,narrativeLeadMs:createdAt!==null&&detectedAt!==null?createdAt-detectedAt:null,marketCapAtFirstSeen:first,marketCapAtMatch:atMatch,currentMarketCap:current,marketCap:current,peakMarketCap:peak,marketCapChangeSinceMatch:delta,marketCapChangePctSinceMatch:change,matchConfidence:Math.round(score*100),tractionScore,momentumStatus,opportunityStatus,marketCapAcceleration:acceleration,volumeAcceleration,lastUpdatedAt:now};
}
export function rankCoins(a:CoinMetrics,b:CoinMetrics){return(coinNumber(b.matchScore)??0)-(coinNumber(a.matchScore)??0)||(coinNumber(b.tractionScore)??0)-(coinNumber(a.tractionScore)??0);}
