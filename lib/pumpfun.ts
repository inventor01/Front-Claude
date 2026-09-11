type DexPair = {
  chainId?: string;
  url?: string;
  priceUsd?: string|number|null;
  pairCreatedAt?: string|number|null;
  marketCap?: string|number|null;
  fdv?: string|number|null;
  liquidity?: {usd?: string|number|null};
  volume?: {h24?: string|number|null};
  priceChange?: {h24?: string|number|null};
  baseToken?: {address?: string;name?: string;symbol?: string};
};

const num=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const safe=(value:unknown)=>typeof value==='string'&&/^https:\/\//i.test(value)?value:null;

/**
 * Fetch market data only after a mint has already been verified by a stored
 * PumpPortal subscribeNewToken/create event. This function never discovers
 * coins and therefore cannot introduce a non-Pump.fun Solana token.
 */
export async function verifiedPumpfunMarket(mint:string){
  const clean=mint.trim();
  if(clean.length<32||clean.length>64)throw new Error('Invalid verified Pump.fun mint.');
  const response=await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(clean)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Market provider returned HTTP ${response.status}`);
  const raw=await response.json() as unknown;
  const pairs=(Array.isArray(raw)?raw:[]) as DexPair[];
  const matching=pairs.filter((pair)=>pair?.chainId==='solana'&&pair.baseToken?.address===clean);
  const best=matching.sort((a,b)=>(num(b.liquidity?.usd)||0)-(num(a.liquidity?.usd)||0)||(num(b.volume?.h24)||0)-(num(a.volume?.h24)||0))[0];
  if(!best)return{mint:clean,marketCap:null,fdv:null,price:null,liquidity:null,volume24h:null,priceChange24h:null,dexUrl:null,marketRefreshedAt:Date.now()};
  const marketCap=num(best.marketCap)??num(best.fdv);
  return{
    mint:clean,
    name:best.baseToken?.name||null,
    symbol:best.baseToken?.symbol||null,
    price:num(best.priceUsd),
    liquidity:num(best.liquidity?.usd),
    volume24h:num(best.volume?.h24),
    priceChange24h:num(best.priceChange?.h24),
    marketCap,
    fdv:num(best.fdv),
    dexUrl:safe(best.url),
    pairCreatedAt:num(best.pairCreatedAt),
    marketRefreshedAt:Date.now(),
  };
}
