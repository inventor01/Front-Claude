import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const CLOUD=String(process.env.FRONT_CLOUD_URL||'https://believable-inspiration-production-a68b.up.railway.app').replace(/\/$/,'');
const KEY=String(process.env.FRONT_BRIDGE_API_KEY||'').trim();
const LOCAL=String(process.env.FRONT_LOCAL_BRIDGE_URL||'http://127.0.0.1:43981').replace(/\/$/,'');
const DATA=process.env.FRONT_BRIDGE_DATA||path.join(os.homedir(),'.front-browser-bridge');
const ID_FILE=path.join(DATA,'cloud-bridge-id');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const clean=(v,max=800)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);

fs.mkdirSync(DATA,{recursive:true});
let bridgeId='';
try{bridgeId=fs.readFileSync(ID_FILE,'utf8').trim();}catch{}
if(!bridgeId){bridgeId='mac-'+randomUUID();fs.writeFileSync(ID_FILE,bridgeId,{mode:0o600});}

async function request(url,options={},timeoutMs=15000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{...options,signal:controller.signal});
    const text=await res.text();let body={};
    try{body=text?JSON.parse(text):{};}catch{body={error:text.slice(0,500)};}
    if(!res.ok)throw new Error(`${res.status} ${body?.error||res.statusText}`);
    return body;
  }finally{clearTimeout(timer);}
}
const local=(path,options={},timeout=15000)=>request(LOCAL+path,options,timeout);
const cloud=(path,options={},timeout=15000)=>request(CLOUD+path,{...options,headers:{'content-type':'application/json','x-front-bridge-key':KEY,...(options.headers||{})}},timeout);

async function localHealth(){
  try{return await local('/health',{},5000);}catch(error){return {ok:false,error:clean(error?.message||error),running:false};}
}
function cloudCapabilities(health){
  return {
    supportedPlatforms:['X','TikTok','Instagram'],
    localScannerVersion:health?.version||null,
    scanner:health?.scanner||null,
    browserConnection:health?.scanConnection||null,
    capabilities:Array.isArray(health?.capabilities)?health.capabilities:[],
  };
}
function mapRequest(req){
  const platforms=new Set(Array.isArray(req.platforms)?req.platforms:[]);
  return {
    mode:req.mode||'scout',
    targetUniqueFeedItems:Number(req.targetUniqueFeedItems||60),
    maxFeedScanSeconds:Number(req.maxSeconds||120),
    keywords:Array.isArray(req.keywords)?req.keywords:[],
    scanXForYou:platforms.has('X'),
    scanTikTokForYou:platforms.has('TikTok'),
    scanInstagram:platforms.has('Instagram'),
  };
}
function statusFromLive(live){
  const phase=String(live?.phase||'').toLowerCase();
  if(/transcript|understand|meaning|narrative|analysis|origin/.test(phase))return 'ANALYZING';
  if(/upload/.test(phase))return 'UPLOADING';
  return 'SCROLLING';
}
function compactResult(scan,live){
  return {
    ok:Boolean(scan?.ok),version:scan?.version||live?.version||null,scanId:scan?.scanId||live?.scanId||null,
    status:live?.status||null,phase:live?.phase||null,observed:Number(live?.observed||0),
    platformCounts:live?.platformCounts||{},sourcePages:Array.isArray(live?.sourcePages)?live.sourcePages.slice(0,40):[],
    inferredTopics:Array.isArray(scan?.inferredTopics)?scan.inferredTopics.slice(0,50):Array.isArray(live?.inferredTopics)?live.inferredTopics.slice(0,50):[],
    errors:Array.isArray(scan?.errors)?scan.errors.slice(-30):Array.isArray(live?.errors)?live.errors.slice(-30):[],
    audit:scan?.audit||null,transcription:scan?.transcription||null,contentUnderstanding:scan?.contentUnderstanding||null,
    videoMeaning:scan?.videoMeaning||null,postUnderstanding:scan?.postUnderstanding||null,at:Date.now()
  };
}
async function uploadEvidence(job,rows,seen){
  const fresh=(Array.isArray(rows)?rows:[]).filter(row=>row?.id&&!seen.has(String(row.id)));
  for(const row of fresh)seen.add(String(row.id));
  for(let i=0;i<fresh.length;i+=50){
    await cloud(`/api/agent/bridge/jobs/${encodeURIComponent(job.id)}/evidence`,{
      method:'POST',body:JSON.stringify({bridgeId,leaseId:job.leaseId,evidence:fresh.slice(i,i+50)})
    },20000);
  }
  return fresh.length;
}
async function runJob(job){
  const seen=new Set();
  let live={};
  let scanResult=null,scanError=null,done=false,cancelled=false;
  const scanPromise=local('/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(mapRequest(job.request))},Math.max(60_000,Number(job.request?.maxSeconds||120)*1000+300_000))
    .then(v=>{scanResult=v;done=true;}).catch(e=>{scanError=e;done=true;});
  while(!done){
    await sleep(3000);
    try{live=await local('/live',{},8000);}catch{}
    try{await uploadEvidence(job,live?.evidence,seen);}catch(error){console.warn('[front-cloud-agent] evidence upload retryable:',clean(error?.message||error));}
    try{
      const hb=await cloud(`/api/agent/bridge/jobs/${encodeURIComponent(job.id)}/heartbeat`,{
        method:'POST',body:JSON.stringify({
          bridgeId,leaseId:job.leaseId,status:statusFromLive(live),phase:live?.phase||'SCROLLING',
          scanId:live?.scanId||null,observedCount:Number(live?.observed||live?.evidence?.length||0),
          platformCounts:live?.platformCounts||{},capabilities:cloudCapabilities(await localHealth())
        })
      });
      if(hb.cancelRequested&&!cancelled){cancelled=true;await local('/stop',{method:'POST'},5000).catch(()=>{});}
    }catch(error){console.warn('[front-cloud-agent] heartbeat retryable:',clean(error?.message||error));}
  }
  await scanPromise;
  try{live=await local('/live',{},8000);}catch{}
  try{await uploadEvidence(job,scanResult?.evidence||live?.evidence,seen);}catch{}
  const localStatus=String(live?.status||'');
  const status=cancelled||localStatus==='stopped'?'CANCELLED':scanError||localStatus==='failed'?'FAILED':'COMPLETED';
  const limitations=[];
  if(!seen.size)limitations.push('Front local browser scan returned no accepted evidence.');
  if(Array.isArray(live?.errors))limitations.push(...live.errors.slice(-10).map(x=>clean(x,400)));
  await cloud(`/api/agent/bridge/jobs/${encodeURIComponent(job.id)}/complete`,{
    method:'POST',body:JSON.stringify({
      bridgeId,leaseId:job.leaseId,status,
      error:scanError?clean(scanError.message,1000):null,
      limitations:[...new Set(limitations)].slice(0,20),
      result:compactResult(scanResult,live)
    })
  },20000);
}
async function loop(){
  if(!KEY){console.log('[front-cloud-agent] disabled: FRONT_BRIDGE_API_KEY is not configured in content.env');return;}
  console.log(`[front-cloud-agent] remote scrolling enabled for ${CLOUD}; bridgeId=${bridgeId}`);
  while(true){
    try{
      const health=await localHealth();
      const claim=await cloud('/api/agent/bridge/claim',{
        method:'POST',body:JSON.stringify({bridgeId,label:os.hostname(),busy:Boolean(health?.running),capabilities:cloudCapabilities(health)})
      },10000);
      if(claim?.job){
        console.log(`[front-cloud-agent] claimed scroll job ${claim.job.id}`);
        await runJob(claim.job);
        console.log(`[front-cloud-agent] finished scroll job ${claim.job.id}`);
      }
    }catch(error){console.warn('[front-cloud-agent] poll retryable:',clean(error?.message||error));}
    await sleep(5000);
  }
}
loop().catch(error=>{console.error('[front-cloud-agent] fatal:',clean(error?.stack||error));process.exitCode=1;});
