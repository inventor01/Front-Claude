type DexPair = {
  chainId?: string;
  url?: string;
  priceUsd?: string|number|null;
  pairCreatedAt?: string|number|null;
  marketCap?: string|number|null;
  fdv?: string|number|null;
  liquidity?: {usd?: string|number|null};
  volume?: Record<string,string|number|null>;
  txns?: Record<string,{buys?:number;sells?:number}>;
  priceChange?: Record<string,string|number|null>;
  baseToken?: {address?: string;name?: string;symbol?: string};
};

const num=(value:unknown)=>{if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const safe=(value:unknown)=>typeof value==='string'&&/^https:\/\//i.test(value)?value:null;

/**
 * Fetch market data only after a mint has already been verified by a stored
 * PumpPortal subscribeNewToken/create event. This function never discovers
 * coins and therefore cannot introduce a non-Pump.fun Solana token.
 */
async function fetchPumpfunMarket(mint:string){
  const clean=mint.trim();
  if(clean.length<32||clean.length>64)throw new Error('Invalid verified Pump.fun mint.');
  const response=await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(clean)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Market provider returned HTTP ${response.status}`);
  const raw=await response.json() as unknown;
  const pairs=(Array.isArray(raw)?raw:[]) as DexPair[];
  const matching=pairs.filter((pair)=>pair?.chainId==='solana'&&pair.baseToken?.address===clean);
  const best=matching.sort((a,b)=>(num(b.liquidity?.usd)||0)-(num(a.liquidity?.usd)||0)||(num(b.volume?.h24)||0)-(num(a.volume?.h24)||0))[0];
  if(!best)return{mint:clean,marketCap:null,fdv:null,price:null,liquidity:null,volume24h:null,priceChange24h:null,dexUrl:null,marketRefreshedAt:Date.now(),volume5m:null,volume1h:null,volume6h:null,priceChange5m:null,priceChange1h:null,priceChange6h:null,buys5m:null,sells5m:null,buys1h:null,sells1h:null};
  const marketCap=num(best.marketCap);
  return{
    mint:clean,
    name:best.baseToken?.name||null,
    symbol:best.baseToken?.symbol||null,
    price:num(best.priceUsd),
    liquidity:num(best.liquidity?.usd),
    volume5m:num(best.volume?.m5),volume1h:num(best.volume?.h1),volume6h:num(best.volume?.h6),
    priceChange5m:num(best.priceChange?.m5),priceChange1h:num(best.priceChange?.h1),priceChange6h:num(best.priceChange?.h6),
    buys5m:num(best.txns?.m5?.buys),sells5m:num(best.txns?.m5?.sells),buys1h:num(best.txns?.h1?.buys),sells1h:num(best.txns?.h1?.sells),
    volume24h:num(best.volume?.h24),
    priceChange24h:num(best.priceChange?.h24),
    marketCap,
    fdv:num(best.fdv),
    dexUrl:safe(best.url),
    pairCreatedAt:num(best.pairCreatedAt),
    marketRefreshedAt:Date.now(),
  };
}

// Share in-flight requests and cache each mint for one minute across narratives.
const marketCache=new Map<string,{expires:number;promise:ReturnType<typeof fetchPumpfunMarket>}>();
export function verifiedPumpfunMarket(mint:string){
 const key=mint.trim(),cached=marketCache.get(key);if(cached&&cached.expires>Date.now())return cached.promise;
 if(marketCache.size>=1000)marketCache.delete(marketCache.keys().next().value!);
 const promise=fetchPumpfunMarket(key).catch(error=>{marketCache.delete(key);throw error;});
 marketCache.set(key,{expires:Date.now()+60000,promise});return promise;
}

const searchCache=new Map<string,{expires:number;promise:Promise<{mint:string;name:string;symbol:string|null}[]>}>();
/** A search hit alone proves no association. Only direct Pump.fun pools qualify here. */
export function discoverPumpfunCoins(query:string){
 const key=query.trim().toLowerCase(),cached=searchCache.get(key);if(cached&&cached.expires>Date.now())return cached.promise;
 if(searchCache.size>=1000)searchCache.delete(searchCache.keys().next().value!);
 const promise=(async()=>{
  const response=await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Coin discovery returned HTTP ${response.status}`);
  const data=await response.json() as {pairs?:Array<DexPair&{dexId?:string}>};
  return [...new Map((Array.isArray(data.pairs)?data.pairs:[]).filter(p=>p.chainId==='solana'&&p.dexId==='pumpfun'&&p.baseToken?.address&&p.baseToken?.name).map(p=>[p.baseToken!.address!,{mint:p.baseToken!.address!,name:p.baseToken!.name!,symbol:p.baseToken!.symbol||null}])).values()];
 })().catch(error=>{searchCache.delete(key);throw error;});
 searchCache.set(key,{expires:Date.now()+120000,promise});return promise;
}
