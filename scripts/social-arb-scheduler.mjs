const enabled=/^(1|true|yes|on)$/i.test(String(process.env.FRONT_SOCIAL_ARB_AUTOSCAN||''));
const interval=Math.max(300000,Math.min(3600000,Number(process.env.FRONT_SOCIAL_ARB_SCHEDULE_MS||900000)));
const port=String(process.env.PORT||8787);
const base=String(process.env.FRONT_INTERNAL_URL||('http://127.0.0.1:'+port)).replace(/\/$/,'');
const key=String(process.env.FRONT_COMMERCE_API_KEY||'');
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

const packs=[
 ['beauty skincare makeup','haircare fragrance personal care','where can I buy','sold out'],
 ['food snacks beverages','restaurants fast food grocery','bought another','new favorite'],
 ['consumer tech gadgets','phones wearables audio accessories','everyone has','worth the hype'],
 ['fashion shoes bags accessories','streetwear workwear basics','switched from','finally found'],
 ['fitness wellness recovery','supplements hydration equipment','repeat purchase','out of stock'],
 ['home kitchen cleaning','furniture decor organization','obsessed with','need to try'],
 ['gaming toys hobbies collectibles','sports gear outdoor recreation','restock','everyone at school'],
 ['pets baby parenting','auto accessories travel products','stopped using','better than'],
 ['apps subscriptions creator tools','retail deals memberships services','cancelled my','switching from'],
 ['work school office products','entertainment culture lifestyle','going to buy','hard to find'],
];

async function json(path,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(base+path,{...options,signal:controller.signal,headers:{'content-type':'application/json','x-front-commerce-key':key,...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(response.status+' '+String(data?.error||response.statusText));
  return data;
 }finally{clearTimeout(timer);}
}
function bucket(now=Date.now()){return Math.floor(now/interval);}
function requestFor(now=Date.now()){
 const b=bucket(now),deep=b%4===0,pack=packs[b%packs.length];
 return{
  requestId:'social-arb-auto-'+b,
  mode:deep?'deep':'scout',
  platforms:['X','TikTok','Instagram'],
  objective:'Observe ordinary consumer and cultural behavior before stock discussion. Detect products, brands, behaviors, shortages, switching, repeat purchase and adoption. Treat finance/ticker chatter only as downstream awareness, never discovery.',
  keywords:pack,
  targetUniqueFeedItems:deep?120:70,
  maxSeconds:deep?420:210,
  maxScrolls:deep?100:60,
  analysis:{transcribeVideos:true,visualUnderstanding:true,contextUnderstanding:true,deriveNarratives:true}
 };
}
async function tick(){
 const active=await json('/api/agent/scroll-jobs');
 if(Number(active.activeCount)>0){
  console.log('[social-arb-autoscan] backpressure: active job exists; skipping enqueue');
  return;
 }
 const body=requestFor();
 const created=await json('/api/agent/scroll-jobs',{method:'POST',body:JSON.stringify(body)});
 console.log('[social-arb-autoscan] queued '+body.mode+' job '+String(created.id||'')+' requestId='+body.requestId);
}
async function main(){
 if(!enabled)return console.log('[social-arb-autoscan] disabled');
 if(!key)return console.log('[social-arb-autoscan] disabled: FRONT_COMMERCE_API_KEY missing');
 console.log('[social-arb-autoscan] enabled interval='+interval+'ms');
 await sleep(25000);
 while(true){
  try{await tick();}catch(error){console.warn('[social-arb-autoscan] tick failed:',String(error?.message||error).slice(0,400));}
  await sleep(interval);
 }
}
main().catch((error)=>{console.error('[social-arb-autoscan] fatal:',error);process.exitCode=1;});
