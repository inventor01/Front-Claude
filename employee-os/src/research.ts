const SHOPIFY_TRENDS='https://r.jina.ai/http://www.shopify.com/blog/trending-products';

export type SourceEvidence={
  sourceType:'SHOPIFY'|'AMAZON'|'ALIEXPRESS'|'FRONT';
  sourceName:string;
  sourceUrl:string;
  summary:string;
  rawExcerpt:string;
  confidence:'LOW'|'MEDIUM'|'HIGH';
};

export type DiscoveryResult={
  candidate:string;
  discoveryMode:'OWNER_QUERY'|'SHOPIFY_TREND';
  trendStatement:string|null;
  trendGrowthPct:number|null;
  evidence:SourceEvidence[];
};

export type DemandResult={
  candidate:string;
  demandScore:number;
  marketplaceSeen:boolean;
  shopifyTrendSeen:boolean;
  observedMarketPrice:number|null;
  evidence:SourceEvidence[];
};

export type SupplierResult={
  candidate:string;
  supplierSeen:boolean;
  observedSourcePrice:number|null;
  evidence:SourceEvidence[];
};

const SAFE_TREND_BLOCK=/\b(?:alcohol|supplement|vitamin|pesticide|beef|meat|energy drink|digestive|medical|drug|nicotine|weapon|firearm)\b/i;
const RISK_IP=/\b(?:action figure|disney|marvel|pokemon|nike|adidas|apple|samsung|lego)\b/i;

function clean(value:string){return value.replace(/\s+/g,' ').trim();}
function significantTokens(value:string){
  return clean(value.toLowerCase()).split(/[^a-z0-9]+/).filter((x)=>x.length>=4 && !['with','from','this','that','portable','product'].includes(x));
}
function jina(target:string){return `https://r.jina.ai/${target}`;}

async function fetchText(url:string,timeoutMs=15000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{headers:{'user-agent':'AI-Employee-OS/0.2 research-evidence'},signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status} for ${url}`);
    const text=await response.text();
    return text.slice(0,400_000);
  }finally{clearTimeout(timer);}
}

function excerpt(text:string,query:string,max=900){
  const lower=text.toLowerCase();
  const tokens=significantTokens(query);
  let index=-1;
  for(const token of tokens){const i=lower.indexOf(token);if(i>=0){index=i;break;}}
  if(index<0)return clean(text.slice(0,max));
  const start=Math.max(0,index-Math.floor(max/3));
  return clean(text.slice(start,start+max));
}

function pricesFrom(text:string){
  const values=[...text.matchAll(/(?:US\s*)?\$\s*([0-9]{1,4}(?:\.[0-9]{1,2})?)/gi)]
    .map((m)=>Number(m[1]))
    .filter((n)=>Number.isFinite(n)&&n>=1&&n<=1000);
  return [...new Set(values)].slice(0,50);
}
function median(values:number[]){
  if(!values.length)return null;
  const s=[...values].sort((a,b)=>a-b);
  const i=Math.floor(s.length/2);
  return s.length%2?s[i]!:(s[i-1]!+s[i]!)/2;
}

export async function discoverCandidate(ownerQuery:string):Promise<DiscoveryResult>{
  const requested=clean(ownerQuery);
  if(requested && !/^module\d|consistency|retest|test$/i.test(requested)){
    return {candidate:requested,discoveryMode:'OWNER_QUERY',trendStatement:null,trendGrowthPct:null,evidence:[]};
  }

  const markdown=await fetchText(SHOPIFY_TRENDS);
  const section=markdown.split('## What products are trending right now?')[1]?.split('#### How were these trending products identified?')[0]||'';
  const rows=section.split('\n').map(clean).filter(Boolean);
  const screened:Array<{name:string;statement:string;row:string;growth:number|null;preScore:number}>=[];
  for(const row of rows){
    const match=row.match(/^\d+\.\s+\*\*(.+?):\*\*\s*(.+)$/);
    if(!match)continue;
    const name=clean(match[1]!);
    const statement=clean(match[2]!);
    if(SAFE_TREND_BLOCK.test(name)||RISK_IP.test(name))continue;
    const growthMatch=statement.match(/([0-9,]+)%/);
    const growth=growthMatch?Number(growthMatch[1]!.replace(/,/g,'')):null;
    const content=evaluateContentability(name).contentabilityScore;
    const safety=reviewRisk(name);
    const growthScore=growth===null?15:Math.min(55,Math.log10(Math.max(1,growth)+1)*18);
    const preScore=Math.round(growthScore+content*.45-safety.riskPenalty);
    screened.push({name,statement,row,growth,preScore});
  }
  if(!screened.length)throw new Error('No safe candidate could be extracted from Shopify trending-product evidence.');
  screened.sort((a,b)=>b.preScore-a.preScore||(b.growth||0)-(a.growth||0));
  const winner=screened[0]!;
  return {
    candidate:winner.name,
    discoveryMode:'SHOPIFY_TREND',
    trendStatement:winner.statement,
    trendGrowthPct:winner.growth,
    evidence:[{
      sourceType:'SHOPIFY',sourceName:'Shopify Trending Products',sourceUrl:'https://www.shopify.com/blog/trending-products',
      summary:`${winner.name}: ${winner.statement}. Selected after screening ${screened.length} safe trend candidates for acceleration, contentability, and obvious risk.`,
      rawExcerpt:winner.row,confidence:'HIGH'
    }]
  };
}

export async function validateDemand(candidate:string,discovery?:DiscoveryResult):Promise<DemandResult>{
  const encoded=encodeURIComponent(candidate);
  const amazonUrl=jina(`https://www.amazon.com/s?k=${encoded}`);
  const [amazon,shopify]=await Promise.all([
    fetchText(amazonUrl).catch(()=>''),fetchText(SHOPIFY_TRENDS).catch(()=>'')
  ]);
  const amazonExcerpt=amazon?excerpt(amazon,candidate,1600):'';
  const shopifyExcerpt=shopify?excerpt(shopify,candidate,1000):'';
  const tokens=significantTokens(candidate);
  const amazonLower=amazon.toLowerCase(),shopifyLower=shopify.toLowerCase();
  const marketplaceSeen=tokens.length>0&&tokens.some((t)=>amazonLower.includes(t));
  const shopifyTrendSeen=(discovery?.discoveryMode==='SHOPIFY_TREND')||(tokens.length>0&&tokens.some((t)=>shopifyLower.includes(t)));
  const marketPrices=pricesFrom(amazonExcerpt);
  const observedMarketPrice=marketPrices.length?median(marketPrices):null;
  let score=0;
  if(marketplaceSeen)score+=45;
  if(shopifyTrendSeen)score+=35;
  if((discovery?.trendGrowthPct||0)>500)score+=15;
  if(observedMarketPrice!==null)score+=5;
  const evidence:SourceEvidence[]=[];
  if(discovery?.evidence?.length)evidence.push(...discovery.evidence);
  if(amazonExcerpt)evidence.push({sourceType:'AMAZON',sourceName:'Amazon search results',sourceUrl:`https://www.amazon.com/s?k=${encoded}`,summary:`Marketplace search evidence for ${candidate}`,rawExcerpt:amazonExcerpt,confidence:marketplaceSeen?'MEDIUM':'LOW'});
  if(shopifyTrendSeen&&shopifyExcerpt)evidence.push({sourceType:'SHOPIFY',sourceName:'Shopify Trending Products',sourceUrl:'https://www.shopify.com/blog/trending-products',summary:`Shopify trend evidence mentioning ${candidate}`,rawExcerpt:shopifyExcerpt,confidence:'HIGH'});
  return {candidate,demandScore:Math.min(100,score),marketplaceSeen,shopifyTrendSeen,observedMarketPrice,evidence};
}

export async function validateSupplier(candidate:string):Promise<SupplierResult>{
  const encoded=encodeURIComponent(candidate);
  const sourceUrl=`https://www.aliexpress.com/wholesale?SearchText=${encoded}`;
  const markdown=await fetchText(jina(sourceUrl)).catch(()=> '');
  const context=markdown?excerpt(markdown,candidate,2200):'';
  const tokens=significantTokens(candidate);
  const lower=markdown.toLowerCase();
  const supplierSeen=tokens.length>0&&tokens.some((t)=>lower.includes(t));
  const observedSourcePrice=median(pricesFrom(context));
  const evidence:SourceEvidence[]=[];
  if(context)evidence.push({sourceType:'ALIEXPRESS',sourceName:'AliExpress search results',sourceUrl,summary:`Supplier search evidence for ${candidate}`,rawExcerpt:context,confidence:supplierSeen?'MEDIUM':'LOW'});
  return {candidate,supplierSeen,observedSourcePrice,evidence};
}

export function computeEconomics(demand:DemandResult,supplier:SupplierResult){
  const market=demand.observedMarketPrice;
  const source=supplier.observedSourcePrice;
  const observedGrossMarginPct=market!==null&&source!==null&&market>source
    ?Math.round(((market-source)/market)*1000)/10:null;
  return {
    observedMarketPrice:market,
    observedSourcePrice:source,
    observedGrossMarginPct,
    note:'Observed search-page prices are evidence points, not guaranteed landed cost or final retail price.'
  };
}

export function evaluateContentability(candidate:string){
  const lower=candidate.toLowerCase();
  let score=45;
  const visual=/clean|tile|fabric|bag|jacket|hoodie|controller|kitchen|organizer|light|mount|pet|car|beauty|tool|bottle|vacuum/i.test(lower);
  const problem=/clean|repair|organizer|mount|protect|remove|fix|portable|pet|kitchen|tool|vacuum/i.test(lower);
  const gift=/bag|controller|coffee|jacket|hoodie|craft|pet|kitchen/i.test(lower);
  if(visual)score+=20;if(problem)score+=15;if(gift)score+=10;
  const angles=[
    `3-second demonstration of ${candidate}`,
    `problem → ${candidate} solution`,
    `before/after using ${candidate}`,
    `POV: first time trying ${candidate}`,
    `${candidate} versus the old way`,
    `unboxing and first reaction`,
    `one feature most people miss`,
    `FAQ / objection demo`,
    `gift or use-case scenario`,
    `customer-style testimonial concept`,
    `myth vs reality`,
    `five hook variations around the strongest demo`
  ];
  return {contentabilityScore:Math.min(95,score),angles,canSupport50Pieces:score>=65};
}

export function reviewRisk(candidate:string){
  const flags:string[]=[];
  let riskPenalty=0;
  if(SAFE_TREND_BLOCK.test(candidate)){flags.push('regulated/consumable category requires specialist compliance review');riskPenalty+=60;}
  if(RISK_IP.test(candidate)){flags.push('possible trademark/IP or branded-category risk');riskPenalty+=30;}
  if(/electrical|battery|charger|heater|laser/i.test(candidate)){flags.push('product safety/certification review required');riskPenalty+=15;}
  if(!flags.length)flags.push('No obvious high-risk keyword detected; manual supplier/IP/compliance review still required before launch.');
  return {flags,riskPenalty,highRisk:riskPenalty>=50};
}

export function scoreCandidate(input:{
  demand:DemandResult;supplier:SupplierResult;economics:ReturnType<typeof computeEconomics>;
  content:ReturnType<typeof evaluateContentability>;risk:ReturnType<typeof reviewRisk>;
}){
  const supplierScore=input.supplier.supplierSeen?20:0;
  const marginScore=input.economics.observedGrossMarginPct===null?5:Math.max(0,Math.min(20,input.economics.observedGrossMarginPct/4));
  const score=Math.round(Math.max(0,Math.min(100,input.demand.demandScore*.35+supplierScore+marginScore+input.content.contentabilityScore*.25-input.risk.riskPenalty)));
  const evidenceCount=input.demand.evidence.length+input.supplier.evidence.length;
  const economicsKnown=input.economics.observedGrossMarginPct!==null;
  const confidence:'HIGH'|'MEDIUM'|'LOW'=evidenceCount>=3&&economicsKnown?'HIGH':evidenceCount>=2?'MEDIUM':'LOW';
  let status:'INVESTIGATING'|'VERIFIED_CANDIDATE'|'LAUNCH_REVIEW'|'REJECTED'='INVESTIGATING';
  if(input.risk.highRisk)status='REJECTED';
  else if(input.demand.marketplaceSeen&&input.supplier.supplierSeen&&evidenceCount>=2&&score>=70&&input.content.canSupport50Pieces)status='LAUNCH_REVIEW';
  else if(input.demand.marketplaceSeen&&input.supplier.supplierSeen&&evidenceCount>=2&&score>=55)status='VERIFIED_CANDIDATE';
  return {score,status,confidence,evidenceCount,economicsKnown};
}
