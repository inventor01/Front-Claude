import { env } from 'cloudflare:workers';

const clean=(value:unknown,max=120)=>String(value??'').trim().slice(0,max);
const tickerPattern=/^[A-Z][A-Z0-9.-]{0,9}$/;
const finite=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null;};
export const environmentTiingoToken=()=>clean((env as unknown as Record<string,unknown>).TIINGO_API_KEY,500);
const resolvedToken=(token?:string|null)=>clean(token||environmentTiingoToken(),500);

export type MarketReference={
 provider:'tiingo';ticker:string;price:number;at:number;kind:'tiingo-reference-price';sourceTimestamp:string|null;
};
export type DailyBar={
 date:string;close:number;adjClose:number|null;volume:number|null;splitFactor:number|null;divCash:number|null;
};

export function socialArbMarketDataStatus(token?:string|null){
 return{
  provider:'tiingo',
  configured:Boolean(resolvedToken(token)),
  purpose:'point-in-time research outcome tracking',
  license:'internal-use',
 };
}

function isoDate(value:number){
 return new Date(value).toISOString().slice(0,10);
}
export function socialArbMarketDate(value:number){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const map=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
 return String(map.year||'')+'-'+String(map.month||'')+'-'+String(map.day||'');
}
function addDays(value:number,days:number){
 return isoDate(value+days*86400000);
}
async function tiingo(path:string,timeoutMs=12000,tokenOverride?:string|null){
 const token=resolvedToken(tokenOverride);
 if(!token)throw new Error('Tiingo is not connected.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetch('https://api.tiingo.com'+path,{
   headers:{Accept:'application/json',Authorization:'Token '+token},
   signal:controller.signal,
  });
  const text=await response.text();
  let data:unknown={};
  try{data=text?JSON.parse(text):{};}catch{data={};}
  if(!response.ok)throw new Error('Tiingo '+response.status);
  return data;
 }finally{clearTimeout(timer);}
}
function rowFromPayload(payload:unknown){
 if(Array.isArray(payload))return payload[0]&&typeof payload[0]==='object'?payload[0] as Record<string,unknown>:null;
 return payload&&typeof payload==='object'?payload as Record<string,unknown>:null;
}
export async function captureSocialArbReference(tickerRaw:string,now=Date.now(),token?:string|null):Promise<MarketReference>{
 const ticker=clean(tickerRaw,12).toUpperCase();
 if(!tickerPattern.test(ticker))throw new Error('Invalid ticker.');
 const payload=await tiingo('/iex/'+encodeURIComponent(ticker),12000,token);
 const row=rowFromPayload(payload);
 const price=finite(row?.tngoLast);
 if(!price)throw new Error('Tiingo reference price unavailable for '+ticker+'.');
 const timestamp=clean(row?.timestamp,80)||null;
 const parsed=timestamp?Date.parse(timestamp):NaN;
 const at=Number.isFinite(parsed)&&parsed<=now+5*60000?parsed:now;
 return{provider:'tiingo',ticker,price,at,kind:'tiingo-reference-price',sourceTimestamp:timestamp};
}
export async function fetchSocialArbDailyBars(tickerRaw:string,startMs:number,endMs:number,token?:string|null):Promise<DailyBar[]>{
 const ticker=clean(tickerRaw,12).toUpperCase();
 if(!tickerPattern.test(ticker))throw new Error('Invalid ticker.');
 const start=addDays(startMs,-2),end=addDays(endMs,1);
 const payload=await tiingo('/tiingo/daily/'+encodeURIComponent(ticker)+'/prices?startDate='+start+'&endDate='+end+'&resampleFreq=daily',15000,token);
 if(!Array.isArray(payload))return[];
 const out:DailyBar[]=[];
 for(const raw of payload){
  if(!raw||typeof raw!=='object')continue;
  const row=raw as Record<string,unknown>;
  const date=clean(row.date,40).slice(0,10),close=finite(row.close);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!close)continue;
  out.push({
   date,close,adjClose:finite(row.adjClose),volume:finite(row.volume),
   splitFactor:finite(row.splitFactor),divCash:Number.isFinite(Number(row.divCash))?Number(row.divCash):null,
  });
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
export async function historicalSocialArbBaseline(ticker:string,researchAt:number,token?:string|null){
 const bars=await fetchSocialArbDailyBars(ticker,researchAt-12*86400000,researchAt,token);
 const researchDate=socialArbMarketDate(researchAt);
 const candidates=bars.filter((bar)=>bar.date<researchDate);
 const bar=candidates[candidates.length-1];
 if(!bar)throw new Error('No prior completed session was available for baseline backfill.');
 return{
  provider:'tiingo' as const,ticker:ticker.toUpperCase(),price:bar.close,
  at:Date.parse(bar.date+'T21:00:00.000Z'),kind:'prior-session-close' as const,sourceTimestamp:bar.date,
 };
}
export function calculateSocialArbHorizons(baselinePrice:number,baselineDate:string,bars:DailyBar[]){
 const future=bars.filter((bar)=>bar.date>baselineDate);
 const indexes:{[key:string]:number}={'1':0,'5':4,'20':19,'60':59};
 const horizons:Record<string,unknown>={};
 for(const [label,index] of Object.entries(indexes)){
  const bar=future[index];
  if(!bar){horizons[label]={status:'pending'};continue;}
  const rawReturn=bar.close/baselinePrice-1;
  horizons[label]={
   status:'measured',sessions:Number(label),date:bar.date,price:bar.close,
   return:Number(rawReturn.toFixed(6)),
   note:'Raw price return; corporate actions are retained in evidence for later adjusted-return reconciliation.',
  };
 }
 return horizons;
}

export async function validateTiingoToken(token:string){
 const value=resolvedToken(token);
 if(value.length<8)throw new Error('Enter a Tiingo API token.');
 const payload=await tiingo('/api/test/',12000,value);
 const row=payload&&typeof payload==='object'?payload as Record<string,unknown>:null;
 const message=clean(row?.message,200).toLowerCase();
 if(!message.includes('success'))throw new Error('Tiingo did not confirm the API token.');
 return{ok:true,provider:'tiingo' as const};
}