import { pool } from './db.js';
import { readCredential,storeCredential,deleteCredential } from './credentials.js';

const API_VERSION='2024-11-06';
const PROVIDER_TEST_MODE=process.env.PROVIDER_TEST_MODE==='1';
const RUNWAY_BASE=PROVIDER_TEST_MODE&&process.env.RUNWAY_TEST_BASE_URL
  ?String(process.env.RUNWAY_TEST_BASE_URL).replace(/\/$/,'')
  :'https://api.dev.runwayml.com';

export const DEFAULT_RENDER_MODEL='gen4.5';
export const DEFAULT_RENDER_CLIPS=3;
export const DEFAULT_RENDER_DURATION=5;
export const DEFAULT_RENDER_CREDITS_PER_SECOND=12;
export const DEFAULT_RENDER_COST_CENTS=DEFAULT_RENDER_CLIPS*DEFAULT_RENDER_DURATION*DEFAULT_RENDER_CREDITS_PER_SECOND;

type RunwayCredential={apiSecret:string;model:string};

type RenderSpec={
  id:string;
  promptText:string;
  promptImage:string;
  ratio:string;
  duration:number;
};

export type RunwayAsset={
  specId:string;
  taskId:string;
  temporaryUrl:string;
  promptText:string;
  model:string;
  duration:number;
  ratio:string;
};

function headers(secret:string,contentType=false){
  return {
    authorization:`Bearer ${secret}`,
    'X-Runway-Version':API_VERSION,
    'user-agent':'AI-Employee-OS/0.6',
    ...(contentType?{'content-type':'application/json'}:{})
  };
}

async function latestConnection(companyId:string){
  const r=await pool.query(`SELECT * FROM tool_connections WHERE company_id=$1 AND provider='RUNWAY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)throw new Error('BLOCKED_EXTERNAL_AUTH: Runway Dev is not connected');
  return r.rows[0];
}

export async function connectRunway(input:{companyId:string;apiSecret:string;model?:string}){
  const apiSecret=input.apiSecret.trim();
  const model=(input.model||DEFAULT_RENDER_MODEL).trim();
  if(apiSecret.length<10)throw new Error('Runway API secret is too short.');
  // Runway has no lightweight account endpoint. A nonexistent task is a non-billable auth probe:
  // 401/403 means the key is invalid; 404 means authentication succeeded.
  const probe=await fetch(`${RUNWAY_BASE}/v1/tasks/00000000-0000-0000-0000-000000000000`,{
    headers:headers(apiSecret)
  });
  if([401,403].includes(probe.status))throw new Error('Runway API secret was rejected.');
  if(![200,404].includes(probe.status)){
    const text=await probe.text();
    throw new Error(`Runway connection check failed (HTTP ${probe.status}): ${text.slice(0,500)}`);
  }

  const existing=await pool.query(`SELECT * FROM tool_connections WHERE company_id=$1 AND provider='RUNWAY'
    ORDER BY updated_at DESC LIMIT 1`,[input.companyId]);
  const metadata={
    model,
    apiVersion:API_VERSION,
    defaultClipCount:DEFAULT_RENDER_CLIPS,
    defaultDurationSeconds:DEFAULT_RENDER_DURATION,
    estimatedDefaultCostCents:DEFAULT_RENDER_COST_CENTS,
    connectedAt:new Date().toISOString()
  };
  let connection;
  if(existing.rowCount){
    const r=await pool.query(`UPDATE tool_connections SET tool_id='runway-dev',risk_class='HIGH',status='CONNECTED',
      metadata=$2,updated_at=now() WHERE id=$1 RETURNING *`,[existing.rows[0].id,JSON.stringify(metadata)]);
    connection=r.rows[0];
  }else{
    const r=await pool.query(`INSERT INTO tool_connections(company_id,tool_id,provider,risk_class,status,metadata)
      VALUES($1,'runway-dev','RUNWAY','HIGH','CONNECTED',$2) RETURNING *`,[input.companyId,JSON.stringify(metadata)]);
    connection=r.rows[0];
  }
  await storeCredential({
    companyId:input.companyId,provider:'RUNWAY',connectionId:String(connection.id),
    secret:{apiSecret,model}
  });
  return {connected:true,connection:{id:connection.id,status:connection.status,metadata}};
}

export async function runwayStatus(companyId:string){
  const r=await pool.query(`SELECT id,status,metadata,updated_at FROM tool_connections WHERE company_id=$1 AND provider='RUNWAY'
    ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {connected:false,status:'NOT_CONNECTED'};
  return {connected:r.rows[0].status==='CONNECTED',status:r.rows[0].status,metadata:r.rows[0].metadata,updatedAt:r.rows[0].updated_at};
}

export async function disconnectRunway(companyId:string){
  const r=await pool.query(`SELECT id FROM tool_connections WHERE company_id=$1 AND provider='RUNWAY' ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {disconnected:false};
  const id=String(r.rows[0].id);
  await deleteCredential(companyId,'RUNWAY',id);
  await pool.query(`UPDATE tool_connections SET status='DISCONNECTED',updated_at=now() WHERE id=$1`,[id]);
  return {disconnected:true};
}

async function credentialFor(companyId:string){
  const connection=await latestConnection(companyId);
  const credential=await readCredential<RunwayCredential>(companyId,'RUNWAY',String(connection.id));
  return {connection,credential};
}

async function createTask(secret:string,model:string,spec:RenderSpec){
  const response=await fetch(`${RUNWAY_BASE}/v1/image_to_video`,{
    method:'POST',headers:headers(secret,true),
    body:JSON.stringify({
      model,
      promptImage:spec.promptImage,
      promptText:spec.promptText,
      ratio:spec.ratio,
      duration:spec.duration
    })
  });
  const raw=await response.text();
  if(!response.ok)throw new Error(`Runway generation request failed (HTTP ${response.status}): ${raw.slice(0,800)}`);
  let data:{id?:string};try{data=JSON.parse(raw);}catch{throw new Error('Runway generation response was invalid JSON.');}
  if(!data.id)throw new Error('Runway did not return a generation task ID.');
  return data.id;
}

async function waitTask(secret:string,taskId:string,timeoutMs=6*60*1000){
  const end=Date.now()+timeoutMs;
  let delay=5000;
  while(Date.now()<end){
    const response=await fetch(`${RUNWAY_BASE}/v1/tasks/${encodeURIComponent(taskId)}`,{headers:headers(secret)});
    const raw=await response.text();
    if(!response.ok)throw new Error(`Runway task lookup failed (HTTP ${response.status}): ${raw.slice(0,800)}`);
    let data:{status?:string;output?:string[];failure?:string;failureCode?:string};try{data=JSON.parse(raw);}catch{throw new Error('Runway task response was invalid JSON.');}
    if(data.status==='SUCCEEDED'){
      const url=Array.isArray(data.output)?String(data.output[0]||''):'';
      if(!url)throw new Error('Runway task succeeded without an output URL.');
      return url;
    }
    if(['FAILED','CANCELED'].includes(String(data.status||''))){
      throw new Error(`Runway task ${data.status}: ${data.failure||data.failureCode||'generation failed'}`);
    }
    await new Promise((resolve)=>setTimeout(resolve,delay));
    delay=Math.min(15000,Math.round(delay*1.25));
  }
  throw new Error('Runway generation did not finish before the six-minute timeout.');
}

export async function renderOriginalProductClips(input:{
  companyId:string;
  promptImage:string;
  specs:Array<{id:string;promptText:string}>;
  clipCount?:number;
  duration?:number;
}):Promise<RunwayAsset[]>{
  if(!/^https:\/\//i.test(input.promptImage))throw new Error('Runway rendering requires a public HTTPS product image.');
  const {credential}=await credentialFor(input.companyId);
  const clipCount=Math.min(3,Math.max(1,input.clipCount||DEFAULT_RENDER_CLIPS));
  const duration=Math.min(10,Math.max(2,input.duration||DEFAULT_RENDER_DURATION));
  const selected=input.specs.slice(0,clipCount);
  if(!selected.length)throw new Error('No creative render specifications were supplied.');

  const tasks:Array<{spec:RenderSpec;taskId:string}>=[];
  for(const row of selected){
    const spec:RenderSpec={
      id:row.id,
      promptImage:input.promptImage,
      promptText:row.promptText.slice(0,1800),
      ratio:'768:1280',
      duration
    };
    const taskId=await createTask(credential.apiSecret,credential.model||DEFAULT_RENDER_MODEL,spec);
    tasks.push({spec,taskId});
  }

  const results=await Promise.all(tasks.map(async({spec,taskId})=>({
    specId:spec.id,
    taskId,
    temporaryUrl:await waitTask(credential.apiSecret,taskId),
    promptText:spec.promptText,
    model:credential.model||DEFAULT_RENDER_MODEL,
    duration:spec.duration,
    ratio:spec.ratio
  })));
  return results;
}
