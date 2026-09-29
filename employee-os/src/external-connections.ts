import { pool } from './db.js';
import { readCredential,storeCredential,deleteCredential } from './credentials.js';
import { startExternalAction,completeExternalAction,failExternalAction } from './external-actions.js';

const AYRSHARE_BASE=(process.env.AYRSHARE_TEST_BASE_URL||'https://app.ayrshare.com').replace(/\/$/,'');
const RESEND_BASE=(process.env.RESEND_TEST_BASE_URL||'https://api.resend.com').replace(/\/$/,'');

type StatusRow={id:string;status:string;metadata:any;updated_at:string};

async function latest(companyId:string,provider:string){
  const r=await pool.query(`SELECT id,status,metadata,updated_at FROM tool_connections
    WHERE company_id=$1 AND provider=$2 ORDER BY updated_at DESC LIMIT 1`,[companyId,provider]);
  return r.rows[0] as StatusRow|undefined;
}
async function upsert(companyId:string,toolId:string,provider:string,risk:string,metadata:any,secret:any){
  const existing=await pool.query(`SELECT * FROM tool_connections WHERE company_id=$1 AND provider=$2 ORDER BY updated_at DESC LIMIT 1`,[companyId,provider]);
  let row;
  if(existing.rowCount){
    const r=await pool.query(`UPDATE tool_connections SET tool_id=$2,risk_class=$3,status='CONNECTED',metadata=$4,updated_at=now()
      WHERE id=$1 RETURNING *`,[existing.rows[0].id,toolId,risk,JSON.stringify(metadata)]);
    row=r.rows[0];
  }else{
    const r=await pool.query(`INSERT INTO tool_connections(company_id,tool_id,provider,risk_class,status,metadata)
      VALUES($1,$2,$3,$4,'CONNECTED',$5) RETURNING *`,[companyId,toolId,provider,risk,JSON.stringify(metadata)]);
    row=r.rows[0];
  }
  await storeCredential({companyId,provider,connectionId:String(row.id),secret});
  return row;
}
async function disconnect(companyId:string,provider:string){
  const row=await latest(companyId,provider);
  if(!row)return {disconnected:false};
  await deleteCredential(companyId,provider,String(row.id));
  await pool.query(`UPDATE tool_connections SET status='DISCONNECTED',updated_at=now() WHERE id=$1`,[row.id]);
  return {disconnected:true};
}
export async function genericStatus(companyId:string,provider:string){
  const row=await latest(companyId,provider);
  if(!row)return {connected:false,status:'NOT_CONNECTED'};
  return {connected:row.status==='CONNECTED',status:row.status,metadata:row.metadata,updatedAt:row.updated_at};
}

function publicBase(value:string){
  const u=new URL(value.trim());
  if(!['http:','https:'].includes(u.protocol))throw new Error('Connection URL must use http or https.');
  u.pathname=u.pathname.replace(/\/$/,'');
  u.search='';u.hash='';
  return u.href.replace(/\/$/,'');
}

export async function connectFront(input:{companyId:string;baseUrl:string;apiKey:string}){
  const baseUrl=publicBase(input.baseUrl);
  const apiKey=input.apiKey.trim();
  const url=new URL('/api/commerce-intel',baseUrl);url.searchParams.set('limit','1');
  const res=await fetch(url,{headers:{'x-front-commerce-key':apiKey,'user-agent':'AI-Employee-OS/0.6'}});
  const text=await res.text();
  if(!res.ok)throw new Error(`Front connection failed (HTTP ${res.status}): ${text.slice(0,500)}`);
  let body:any;try{body=JSON.parse(text);}catch{throw new Error('Front returned invalid JSON.');}
  if(body?.contract?.launchAuthority!==false)throw new Error('Front contract check failed: launchAuthority must be false.');
  const metadata={baseUrl,diagnostics:body.diagnostics||{},connectedAt:new Date().toISOString(),role:'social + commerce intelligence gateway'};
  const row=await upsert(input.companyId,'front-intelligence','FRONT','LOW',metadata,{baseUrl,apiKey});
  return {connected:true,connection:{id:row.id,status:row.status,metadata}};
}
export const frontStatus=(companyId:string)=>genericStatus(companyId,'FRONT');
export const disconnectFront=(companyId:string)=>disconnect(companyId,'FRONT');

export async function frontCredential(companyId:string){
  const row=await latest(companyId,'FRONT');
  if(!row||row.status!=='CONNECTED')return null;
  return readCredential<{baseUrl:string;apiKey:string}>(companyId,'FRONT',String(row.id));
}

export async function connectAyrshare(input:{companyId:string;apiKey:string}){
  const apiKey=input.apiKey.trim();
  const res=await fetch(`${AYRSHARE_BASE}/api/user`,{headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json','user-agent':'AI-Employee-OS/0.6'}});
  const text=await res.text();
  if(!res.ok)throw new Error(`Ayrshare connection failed (HTTP ${res.status}): ${text.slice(0,500)}`);
  let body:any;try{body=JSON.parse(text);}catch{throw new Error('Ayrshare returned invalid JSON.');}
  const connected=Array.isArray(body?.activeSocialAccounts)?body.activeSocialAccounts:Array.isArray(body?.connected)?body.connected:[];
  const metadata={connectedPlatforms:connected,profileTitle:body?.title||body?.profileTitle||null,connectedAt:new Date().toISOString(),provider:'Ayrshare'};
  const row=await upsert(input.companyId,'ayrshare-social','SOCIAL_PUBLISHER','HIGH',metadata,{apiKey});
  return {connected:true,connection:{id:row.id,status:row.status,metadata}};
}
export const socialStatus=(companyId:string)=>genericStatus(companyId,'SOCIAL_PUBLISHER');
export const disconnectSocial=(companyId:string)=>disconnect(companyId,'SOCIAL_PUBLISHER');

export async function connectResend(input:{companyId:string;apiKey:string;fromEmail:string}){
  const apiKey=input.apiKey.trim(),fromEmail=input.fromEmail.trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail))throw new Error('Provide a valid support from-email address.');
  const res=await fetch(`${RESEND_BASE}/domains?limit=100`,{headers:{authorization:`Bearer ${apiKey}`,'user-agent':'AI-Employee-OS/0.6'}});
  const text=await res.text();
  if(!res.ok)throw new Error(`Resend connection failed (HTTP ${res.status}): ${text.slice(0,500)}`);
  let body:any;try{body=JSON.parse(text);}catch{throw new Error('Resend returned invalid JSON.');}
  const domains=Array.isArray(body?.data)?body.data:[];
  const domain=fromEmail.split('@')[1]!.toLowerCase();
  const verified=domains.find((d:any)=>String(d?.name||'').toLowerCase()===domain&&String(d?.status||'').toLowerCase()==='verified');
  if(!verified)throw new Error(`Resend domain ${domain} is not verified for sending.`);
  const metadata={fromEmail,domain,domainId:verified.id,connectedAt:new Date().toISOString(),provider:'Resend'};
  const row=await upsert(input.companyId,'resend-email','EMAIL','MEDIUM',metadata,{apiKey,fromEmail});
  return {connected:true,connection:{id:row.id,status:row.status,metadata}};
}
export const emailStatus=(companyId:string)=>genericStatus(companyId,'EMAIL');
export const disconnectEmail=(companyId:string)=>disconnect(companyId,'EMAIL');

export async function connectJina(input:{companyId:string;apiKey:string}){
  const apiKey=input.apiKey.trim();
  const res=await fetch('https://s.jina.ai/employee%20os%20verification%20connection%20test',{
    headers:{authorization:`Bearer ${apiKey}`,accept:'application/json','user-agent':'AI-Employee-OS/0.6'}
  });
  const text=await res.text();
  if(!res.ok)throw new Error(`Jina Search connection failed (HTTP ${res.status}): ${text.slice(0,500)}`);
  const metadata={connectedAt:new Date().toISOString(),provider:'Jina Search',purpose:'tool discovery + verification research'};
  const row=await upsert(input.companyId,'jina-search','SEARCH','LOW',metadata,{apiKey});
  return {connected:true,connection:{id:row.id,status:row.status,metadata}};
}
export const searchStatus=(companyId:string)=>genericStatus(companyId,'SEARCH');
export const disconnectSearch=(companyId:string)=>disconnect(companyId,'SEARCH');
export async function searchCredential(companyId:string){
  const row=await latest(companyId,'SEARCH');
  if(!row||row.status!=='CONNECTED')return null;
  return readCredential<{apiKey:string}>(companyId,'SEARCH',String(row.id));
}


export async function publishSocial(input:{
  companyId:string;jobId:string|null;workOrderId:string|null;employeeSlug:string;idempotencyKey:string;
  post:string;platforms:string[];mediaUrls:string[];scheduleDate?:string|null;
}){
  const row=await latest(input.companyId,'SOCIAL_PUBLISHER');
  if(!row||row.status!=='CONNECTED')throw new Error('BLOCKED_EXTERNAL_AUTH: Social publishing is not connected');
  const credential=await readCredential<{apiKey:string}>(input.companyId,'SOCIAL_PUBLISHER',String(row.id));
  const started=await startExternalAction({
    companyId:input.companyId,jobId:input.jobId,workOrderId:input.workOrderId,employeeSlug:input.employeeSlug,
    provider:'AYRSHARE',actionType:'SOCIAL_PUBLISH',target:input.platforms.join(','),idempotencyKey:input.idempotencyKey
  });
  if(started.reused)return started.result;
  const body:Record<string,unknown>={post:input.post,platforms:input.platforms,mediaUrls:input.mediaUrls};
  if(input.scheduleDate)body.scheduleDate=input.scheduleDate;
  let res:Response;
  try{
    res=await fetch(`${AYRSHARE_BASE}/api/post`,{
      method:'POST',
      headers:{authorization:`Bearer ${credential.apiKey}`,'content-type':'application/json','user-agent':'AI-Employee-OS/0.7'},
      body:JSON.stringify(body)
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Ayrshare network failure';
    await failExternalAction(String(started.action.id),message,'RECONCILIATION_REQUIRED');
    throw new Error(`BLOCKED_EXTERNAL_RECONCILIATION: Ayrshare request outcome is unknown; reconcile before retry. ${message}`);
  }
  const text=await res.text();
  if(!res.ok){
    const message=`Ayrshare publish failed (HTTP ${res.status}): ${text.slice(0,800)}`;
    await failExternalAction(String(started.action.id),message,res.status===429||res.status>=500?'RETRYABLE_FAILURE':'FAILED');
    throw new Error(message);
  }
  let parsed:any;
  try{parsed=JSON.parse(text);}catch{
    await failExternalAction(String(started.action.id),'Ayrshare returned invalid publish JSON.','RECONCILIATION_REQUIRED');
    throw new Error('BLOCKED_EXTERNAL_RECONCILIATION: Ayrshare returned an ambiguous publish response.');
  }
  if(parsed?.status==='error'||parsed?.error){
    const message=`Ayrshare publish failed: ${String(parsed.error||parsed.message||'unknown error')}`;
    await failExternalAction(String(started.action.id),message,'FAILED'); throw new Error(message);
  }
  const externalId=String(parsed?.id||parsed?.postIds?.[0]?.id||'')||null;
  await completeExternalAction(String(started.action.id),externalId,parsed);
  return parsed;
}

export async function sendSupportEmail(input:{
  companyId:string;jobId:string|null;workOrderId:string|null;employeeSlug:string;idempotencyKey:string;
  to:string;subject:string;text:string;
}){
  const row=await latest(input.companyId,'EMAIL');
  if(!row||row.status!=='CONNECTED')throw new Error('BLOCKED_EXTERNAL_AUTH: Customer email is not connected');
  const credential=await readCredential<{apiKey:string;fromEmail:string}>(input.companyId,'EMAIL',String(row.id));
  const started=await startExternalAction({
    companyId:input.companyId,jobId:input.jobId,workOrderId:input.workOrderId,employeeSlug:input.employeeSlug,
    provider:'RESEND',actionType:'EMAIL_SEND',target:input.to,idempotencyKey:input.idempotencyKey
  });
  if(started.reused)return started.result;
  let res:Response;
  try{
    res=await fetch(`${RESEND_BASE}/emails`,{
      method:'POST',
      headers:{
        authorization:`Bearer ${credential.apiKey}`,'content-type':'application/json','user-agent':'AI-Employee-OS/0.7',
        'Idempotency-Key':input.idempotencyKey.slice(0,256)
      },
      body:JSON.stringify({from:credential.fromEmail,to:[input.to],subject:input.subject,text:input.text})
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Resend network failure';
    await failExternalAction(String(started.action.id),message,'RETRYABLE_FAILURE');
    throw new Error(`Temporary Resend connection failure: ${message}`);
  }
  const raw=await res.text();
  if(!res.ok){
    const message=`Resend send failed (HTTP ${res.status}): ${raw.slice(0,800)}`;
    await failExternalAction(String(started.action.id),message,res.status===429||res.status>=500?'RETRYABLE_FAILURE':'FAILED');
    throw new Error(message);
  }
  let body:any;
  try{body=JSON.parse(raw);}catch{
    await failExternalAction(String(started.action.id),'Resend returned invalid send JSON.','RETRYABLE_FAILURE');
    throw new Error('Temporary Resend response parsing failure.');
  }
  if(!body?.id){
    await failExternalAction(String(started.action.id),'Resend did not return a message id.','FAILED');
    throw new Error('Resend did not return a message id.');
  }
  const result={id:String(body.id),from:credential.fromEmail,to:input.to};
  await completeExternalAction(String(started.action.id),result.id,result);
  return result;
}
