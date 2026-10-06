/* eslint-disable @typescript-eslint/no-explicit-any -- external SEC/RSS payloads are validated at the boundary. */
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { db, noStore, requireBridge } from '@/lib/front-agent-auth';
import { samePublicOrigin } from '@/lib/request-origin';
import { captureSocialArbReference, socialArbMarketDataStatus } from '@/lib/social-arb-market-data';
import { getProviderSecret } from '@/lib/front-provider-secrets';

const clean=(value:unknown,max=500)=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,max);
const generic=new Set(['product','products','brand','brands','company','companies','item','items','store','stores','trend','trending','viral','thing','things']);
const SEC_HEADERS={'Accept':'application/json,text/html;q=0.9,*/*;q=0.8','User-Agent':'Front Social Arbitrage research tool'};
const FORMS=new Set(['10-K','10-Q','8-K','10-K/A','10-Q/A']);

function parseJson(value:unknown,fallback:any={}){
 try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}
}
function xmlDecode(value:string){
 return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function textOnly(value:string){
 return xmlDecode(value.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).toLowerCase();
}
function researchTerms(row:any,data:any){
 const values=[row.brand,row.product,row.title,data?.brandCandidate,data?.product].map((x)=>clean(x,120)).filter(Boolean);
 return [...new Set(values)].filter((value)=>{
  const words=value.toLowerCase().split(/\s+/).filter(Boolean);
  return value.length>=3&&words.some((word)=>word.length>=3&&!generic.has(word));
 }).slice(0,4);
}
async function secTicker(ticker:string){
 try{
  const response=await fetch('https://www.sec.gov/files/company_tickers.json',{headers:SEC_HEADERS,signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;
  const data=await response.json() as Record<string,{cik_str?:unknown;ticker?:unknown;title?:unknown}>;
  for(const raw of Object.values(data||{})){
   if(clean(raw?.ticker,12).toUpperCase()===ticker)return{cik:String(raw.cik_str||''),name:clean(raw.title,180)};
  }
 }catch{}
 return null;
}
async function boundedText(url:string,headers:Record<string,string>,maxBytes=4_000_000){
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(String(response.status));
 const buffer=await response.arrayBuffer();
 const bytes=new Uint8Array(buffer,0,Math.min(buffer.byteLength,maxBytes));
 return new TextDecoder().decode(bytes);
}
async function filingAwareness(ticker:string,terms:string[]){
 const identity=await secTicker(ticker);
 if(!identity?.cik)return{ok:false,count:0,evidence:[],error:'SEC ticker identity unavailable'};
 const cik=String(identity.cik).replace(/\D/g,'').padStart(10,'0');
 try{
  const response=await fetch('https://data.sec.gov/submissions/CIK'+cik+'.json',{headers:SEC_HEADERS,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('SEC submissions '+response.status);
  const payload=await response.json() as any;
  const recent=payload?.filings?.recent||{};
  const accession=Array.isArray(recent.accessionNumber)?recent.accessionNumber:[];
  const forms=Array.isArray(recent.form)?recent.form:[];
  const docs=Array.isArray(recent.primaryDocument)?recent.primaryDocument:[];
  const dates=Array.isArray(recent.filingDate)?recent.filingDate:[];
  const candidates:any[]=[];
  for(let i=0;i<accession.length&&candidates.length<4;i++){
   if(!FORMS.has(String(forms[i]||'')))continue;
   const doc=String(docs[i]||'').replace(/[^A-Za-z0-9._-]/g,'');
   const acc=String(accession[i]||'').replace(/-/g,'');
   if(!doc||!acc)continue;
   candidates.push({
    form:String(forms[i]),filed:String(dates[i]||''),
    url:'https://www.sec.gov/Archives/edgar/data/'+String(Number(identity.cik))+'/'+acc+'/'+doc
   });
  }
  const checked=await Promise.all(candidates.map(async(candidate)=>{
   try{
    const body=textOnly(await boundedText(candidate.url,{'User-Agent':SEC_HEADERS['User-Agent'],'Accept':'text/html,*/*'},1_500_000));
    const matched=terms.filter((term)=>body.includes(term.toLowerCase()));
    return matched.length?{source:'SEC filing',form:candidate.form,filed:candidate.filed,matchedTerms:matched,url:candidate.url}:null;
   }catch{return null;}
  }));
  const evidence=checked.filter(Boolean);
  return{ok:true,count:evidence.length,evidence,cik:identity.cik,company:identity.name,checked:candidates.length};
 }catch(error){
  return{ok:false,count:0,evidence:[],error:clean((error as Error).message,180)};
 }
}
function rssItems(xml:string){
 const out:any[]=[];
 for(const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)){
  const item=match[1];
  const read=(name:string)=>{
   const pattern=new RegExp('<'+name+'(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/'+name+'>','i');
   return xmlDecode(item.match(pattern)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  };
  const title=read('title'),link=read('link'),pubDate=read('pubDate'),source=read('source');
  if(title&&/^https:\/\//.test(link))out.push({source:source||'Google News',title:clean(title,260),url:link,published:pubDate||null});
  if(out.length>=12)break;
 }
 return out;
}
async function financialAwareness(company:string,ticker:string,terms:string[]){
 if(!company&&!ticker)return{ok:false,count:0,evidence:[],error:'Company identity unavailable'};
 const subject=terms[0]||'';
 const parts=[company||ticker,subject,'earnings revenue sales stock investor analyst','when:90d'].filter(Boolean);
 const query=parts.join(' ');
 const url='https://news.google.com/rss/search?q='+encodeURIComponent(query)+'&hl=en-US&gl=US&ceid=US:en';
 try{
  const response=await fetch(url,{headers:{'Accept':'application/rss+xml,application/xml,text/xml'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('News RSS '+response.status);
  const evidence=rssItems(await response.text());
  return{ok:true,count:evidence.length,evidence,query};
 }catch(error){
  return{ok:false,count:0,evidence:[],error:clean((error as Error).message,180),query};
 }
}
function awarenessState(filings:any,news:any){
 if(!filings.ok&&!news.ok)return'insufficient-data';
 if(Number(filings.count)>=2||Number(news.count)>=8)return'parity-likely';
 if(Number(filings.count)>=1||Number(news.count)>=3)return'emerging-awareness';
 return'low-awareness';
}
function materialityState(row:any,data:any){
 if(Number(row.ticker_verified)!==1)return'unverified-public-company-exposure';
 const relation=String(row.relation||'');
 const confidence=Math.max(0,Math.min(1,Number(data?.mappingConfidence)||0));
 if(relation==='owner'&&confidence>=0.75&&row.materiality==='high')return'direct-exposure-high-hypothesis';
 if(relation==='owner')return'direct-exposure-unquantified';
 if(['supplier','retailer','competitor','platform'].includes(relation))return'indirect-exposure-unquantified';
 return'exposure-unquantified';
}
function gapState(row:any,data:any,awareness:string){
 const score=Number(row.score)||0;
 const voices=Number(data?.independentVoiceCount||row.author_count)||0;
 if(Number(row.ticker_verified)!==1)return'company-unresolved';
 if(score<45||voices<2)return'weak-social-evidence';
 if(awareness==='insufficient-data')return'insufficient-awareness-data';
 if(awareness==='parity-likely')return'parity-likely';
 if(awareness==='emerging-awareness')return score>=64?'gap-narrowing':'monitor';
 if(awareness==='low-awareness'&&score>=64)return'high-information-gap-candidate';
 return'early-information-gap-candidate';
}

export async function GET(){
 const user=await getChatGPTUser();
 if(!user)return noStore({error:'Please sign in to use Social Arb research.'},401);
 try{
  const rows=await db().prepare('SELECT * FROM social_arb_research_runs WHERE owner=? ORDER BY researched DESC LIMIT 400').bind(user.userId).all<any>();
  const latest=new Map<string,any>();
  for(const row of rows.results){
   const key=String(row.signal_key);
   if(!latest.has(key))latest.set(key,{...parseJson(row.data,{}),id:row.id,signalKey:key,researched:Number(row.researched)||0,materialityStatus:row.materiality_status,awarenessStatus:row.awareness_status,informationGapState:row.information_gap_state,filingCount:Number(row.filing_count)||0,financialNewsCount:Number(row.financial_news_count)||0});
  }
  return noStore({research:[...latest.values()]});
 }catch(error){
  return noStore({error:(error as Error).message},502);
 }
}

export async function POST(request:Request){
 const bridgeRequested=Boolean(request.headers.get('x-front-bridge-key'));
 let owner='';
 let bridgeAuthenticated=false;
 if(bridgeRequested){
  try{owner=requireBridge(request);bridgeAuthenticated=true;}catch(error){if(error instanceof Response)return error;throw error;}
 }else{
  const user=await getChatGPTUser();
  if(!user)return noStore({error:'Please sign in to research a Social Arb candidate.'},401);
  owner=user.userId;
 }
 if(!bridgeAuthenticated&&!samePublicOrigin(request))return noStore({error:'Invalid request origin.'},403);
 try{
  const body=await request.json() as {signalKey?:unknown};
  const signalKey=clean(body.signalKey,180).toLowerCase();
  if(signalKey.length<3)return noStore({error:'signalKey is required.'},400);
  const row=await db().prepare('SELECT * FROM social_arb_observations WHERE owner=? AND signal_key=? ORDER BY observed DESC LIMIT 1').bind(owner,signalKey).first<any>();
  if(!row)return noStore({error:'Social Arb signal not found.'},404);
  const data=parseJson(row.data,{});
  const terms=researchTerms(row,data);
  const ticker=clean(row.ticker,12).toUpperCase();
  const results=await Promise.all([
   ticker?filingAwareness(ticker,terms):Promise.resolve({ok:false,count:0,evidence:[],error:'Ticker unresolved'}),
   financialAwareness(clean(row.company_name,180),ticker,terms),
  ]);
  const filings=results[0],news=results[1];
  const awarenessStatus=awarenessState(filings,news);
  const materialityStatus=materialityState(row,data);
  const informationGapState=gapState(row,data,awarenessStatus);
  const researched=Date.now(),id=crypto.randomUUID();
  const result={
   id,signalKey,researched,title:row.title,product:row.product,brand:row.brand,companyName:row.company_name,ticker:row.ticker,
   social:{score:Number(row.score)||0,status:row.status,authorCount:Number(row.author_count)||0,evidenceCount:Number(row.evidence_count)||0,independentVoiceCount:Number(data?.independentVoiceCount)||Number(row.author_count)||0},
   materiality:{status:materialityStatus,hypothesis:row.materiality||null,note:'Front does not infer product-level financial materiality from virality alone. Exposure remains unquantified until company or segment evidence supports it.'},
   awareness:{status:awarenessStatus,filings,financialNews:news},
   informationGap:{state:informationGapState,note:informationGapState==='high-information-gap-candidate'?'Strong social change with little detected filing or financial-media awareness. This is a research candidate, not a trade instruction.':informationGapState==='parity-likely'?'The trend appears broadly represented in company filings and/or financial media; the informational edge may be substantially reduced.':'Front is still gathering evidence; do not treat this state as a trading signal.'},
  };
  await db().prepare('INSERT INTO social_arb_research_runs(owner,id,signal_key,researched,social_score,social_status,materiality_status,awareness_status,information_gap_state,filing_count,financial_news_count,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(owner,id,signalKey,researched,Number(row.score)||0,String(row.status||'WATCH'),materialityStatus,awarenessStatus,informationGapState,Number((filings as any).count)||0,Number((news as any).count)||0,JSON.stringify(result)).run();

  let outcome:{status:string;provider:string;baselinePrice:number|null;baselineAt:number|null;baselineKind:string|null;error?:string|null}|null=null;
  if(ticker){
   const providerToken=await getProviderSecret(owner,'tiingo').catch(()=>null);
   const market=socialArbMarketDataStatus(providerToken);
   let status=market.configured?'capture-failed':'provider-unconfigured';
   let baselinePrice:number|null=null,baselineAt:number|null=null,baselineKind:string|null=null,sourceTimestamp:string|null=null,error:string|null=null;
   if(market.configured){
    try{
     const baseline=await captureSocialArbReference(ticker,researched,providerToken);
     baselinePrice=baseline.price;baselineAt=baseline.at;baselineKind=baseline.kind;sourceTimestamp=baseline.sourceTimestamp;status='tracking';
    }catch(reason){error=clean((reason as Error).message,300);}
   }
   const outcomeData={
    horizons:{},sourceTimestamp,
    note:market.configured?'Point-in-time price capture created with Tiingo.':'Tiingo is not connected. Front will preserve this research timestamp and may backfill only the prior completed session close later; it will never invent a live price.',
    error,
   };
   await db().prepare('INSERT INTO social_arb_outcomes(owner,research_id,signal_key,ticker,provider,captured,baseline_price,baseline_at,baseline_kind,status,last_evaluated,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(owner,id,signalKey,ticker,market.provider,researched,baselinePrice,baselineAt,baselineKind,status,null,JSON.stringify(outcomeData)).run();
   outcome={status,provider:market.provider,baselinePrice,baselineAt,baselineKind,error};
  }
  return noStore({...result,outcome});
 }catch(error){
  return noStore({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},502);
 }
}