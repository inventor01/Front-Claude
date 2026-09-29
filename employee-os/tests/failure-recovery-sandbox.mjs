import http from 'node:http';
import assert from 'node:assert/strict';

const PORT=4370;
process.env.AYRSHARE_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.RESEND_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.PROVIDER_TEST_MODE='1';
process.env.RUNWAY_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;

let emailCalls=0,socialCalls=0,runwayCreates=0,runwayLookups=0;
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json'});res.end(body);}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  for await(const _ of req){}
  if(req.method==='GET'&&u.pathname==='/domains')return json(res,200,{data:[{id:'d1',name:'example.test',status:'verified'}]});
  if(req.method==='GET'&&u.pathname==='/api/user')return json(res,200,{activeSocialAccounts:['instagram']});
  if(req.method==='POST'&&u.pathname==='/emails'){
    emailCalls++;
    if(emailCalls===1)return json(res,429,{error:'rate limited'});
    return json(res,200,{id:'email-recovered-1'});
  }
  if(req.method==='POST'&&u.pathname==='/api/post'){
    socialCalls++;
    if(socialCalls===1){req.socket.destroy();return;}
    return json(res,200,{status:'success',id:'should-not-happen'});
  }
  if(req.method==='GET'&&u.pathname==='/v1/tasks/00000000-0000-0000-0000-000000000000')return json(res,404,{error:'not found'});
  if(req.method==='POST'&&u.pathname==='/v1/image_to_video'){runwayCreates++;return json(res,200,{id:'runway-recovery-task'});}
  if(req.method==='GET'&&u.pathname==='/v1/tasks/runway-recovery-task'){
    runwayLookups++;
    if(runwayLookups===1)return json(res,503,{error:'temporary'});
    return json(res,200,{status:'SUCCEEDED',output:['https://cdn.example.test/recovered.mp4']});
  }
  return json(res,404,{error:'unhandled'});
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const {pool}=await import('../dist/db.js');
const {connectResend,connectAyrshare,sendSupportEmail,publishSocial}=await import('../dist/external-connections.js');
const {connectRunway,renderOriginalProductClips}=await import('../dist/runway-executor.js');

try{
  const company=(await pool.query("INSERT INTO companies(name) VALUES('Failure Recovery QA') RETURNING id")).rows[0].id;
  await connectResend({companyId:company,apiKey:'email-key-recovery-123',fromEmail:'support@example.test'});
  await connectAyrshare({companyId:company,apiKey:'social-key-recovery-123'});
  await connectRunway({companyId:company,apiSecret:'runway-key-recovery-123',model:'gen4.5'});

  const emailInput={companyId:company,jobId:null,workOrderId:null,employeeSlug:'ellis',idempotencyKey:'recover-email',
    to:'qa@example.test',subject:'QA',text:'QA'};
  await assert.rejects(()=>sendSupportEmail(emailInput),/429/);
  const email=await sendSupportEmail(emailInput);
  assert.equal(email.id,'email-recovered-1');
  assert.equal(emailCalls,2);

  const socialInput={companyId:company,jobId:null,workOrderId:null,employeeSlug:'nova',idempotencyKey:'reconcile-social',
    post:'qa',platforms:['instagram'],mediaUrls:['https://cdn.example.test/a.mp4']};
  await assert.rejects(()=>publishSocial(socialInput),/BLOCKED_EXTERNAL_RECONCILIATION/);
  await assert.rejects(()=>publishSocial(socialInput),/BLOCKED_EXTERNAL_RECONCILIATION/);
  assert.equal(socialCalls,1,'ambiguous social outcome must not be resent automatically');

  const renderInput={companyId:company,jobId:null,workOrderId:null,employeeSlug:'maya',idempotencyKey:'recover-runway',
    promptImage:'https://cdn.example.test/product.jpg',specs:[{id:'clip',promptText:'qa'}],clipCount:1,duration:5};
  await assert.rejects(()=>renderOriginalProductClips(renderInput),/503/);
  const render=await renderOriginalProductClips(renderInput);
  assert.equal(render[0].taskId,'runway-recovery-task');
  assert.equal(runwayCreates,1,'Runway retry must reuse existing provider task');
  assert.equal(runwayLookups,2);

  const rows=await pool.query("SELECT provider,status,attempt_count,provider_external_id FROM external_actions WHERE company_id=$1 ORDER BY provider",[company]);
  const by=Object.fromEntries(rows.rows.map(r=>[r.provider,r]));
  assert.equal(by.RESEND.status,'SUCCEEDED');
  assert.equal(Number(by.RESEND.attempt_count),2);
  assert.equal(by.AYRSHARE.status,'RECONCILIATION_REQUIRED');
  assert.equal(Number(by.AYRSHARE.attempt_count),1);
  assert.equal(by.RUNWAY.status,'SUCCEEDED');
  assert.equal(Number(by.RUNWAY.attempt_count),2);

  console.log('FAILURE RECOVERY SANDBOX QA PASSED');
  console.log(JSON.stringify({emailCalls,socialCalls,runwayCreates,runwayLookups,
    resendRecovered:true,socialAmbiguityBlocked:true,runwayTaskReused:true},null,2));
}finally{
  await pool.end();await new Promise(r=>server.close(r));
}
