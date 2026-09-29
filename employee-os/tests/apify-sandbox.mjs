import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import pg from 'pg';
const {Pool}=pg;

const MOCK_PORT=4390,API_PORT=4391;
process.env.PROVIDER_TEST_MODE='1';
process.env.APIFY_TEST_BASE_URL=`http://127.0.0.1:${MOCK_PORT}`;

let actorChecks=0,captures=0;
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json'});res.end(body);}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://127.0.0.1:${MOCK_PORT}`);
  const chunks=[];for await(const c of req)chunks.push(c);
  if(req.method==='GET'&&u.pathname.startsWith('/v2/acts/')){actorChecks++;return json(res,200,{data:{id:'actor'}});}
  if(req.method==='POST'&&u.pathname.includes('/run-sync-get-dataset-items')){
    captures++;return json(res,200,[{
      caption:'A product demo reference',ownerUsername:'creator',videoUrl:'https://cdn.example.test/ref.mp4',
      displayUrl:'https://cdn.example.test/ref.jpg',likesCount:1000,commentsCount:50,videoViewCount:10000
    }]);
  }
  return json(res,404,{error:'unhandled'});
});
await new Promise(r=>server.listen(MOCK_PORT,'127.0.0.1',r));

const child=spawn('node',['dist/api.js'],{env:{...process.env,PORT:String(API_PORT),PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
const wait=async(fn,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('timeout');};
await wait(async()=>{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`);return r.ok;});
const call=async(path,opts={})=>{const r=await fetch(`http://127.0.0.1:${API_PORT}${path}`,opts);const d=await r.json();if(!r.ok)throw new Error(d.error||String(r.status));return d;};

const reg=await call('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  email:`apify-${Date.now()}@example.test`,password:'Apify-QA-Password-123!',companyName:'Apify QA'
})});
const company=reg.company.id,token=reg.token,auth={authorization:'Bearer '+token,'content-type':'application/json'};
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
try{
  const member=(await db.query('SELECT user_id FROM memberships WHERE company_id=$1',[company])).rows[0];
  const objective=(await db.query("INSERT INTO objectives(company_id,created_by,statement,constraints) VALUES($1,$2,'Reference QA','[]') RETURNING id",[company,member.user_id])).rows[0];
  const project=(await db.query("INSERT INTO projects(company_id,objective_id,name,phase,status) VALUES($1,$2,'Reference QA','SOURCE_CAPTURE','ACTIVE') RETURNING id",[company,objective.id])).rows[0];
  const work=(await db.query("INSERT INTO work_orders(company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria,blockers) VALUES($1,$2,'ava','rowan','Identify the reference product and verify the opportunity','BLOCKED_EXTERNAL_AUTH','LOW','[]',$3) RETURNING id",[company,project.id,JSON.stringify(['BLOCKED_EXTERNAL_AUTH'])])).rows[0];
  const job=(await db.query("INSERT INTO jobs(company_id,project_id,work_order_id,employee_slug,job_type,payload,status,idempotency_key,last_error) VALUES($1,$2,$3,'rowan','LINK_PRODUCT_RESEARCH','{}','BLOCKED',$4,'BLOCKED_EXTERNAL_AUTH: APIFY is not connected') RETURNING id",[company,project.id,work.id,`apify-qa-${Date.now()}`])).rows[0];
  await db.query("INSERT INTO job_steps(company_id,job_id,sequence,step_type,status) VALUES($1,$2,1,'SOURCE_CAPTURE','BLOCKED')",[company,job.id]);
  await db.query("INSERT INTO reference_sources(company_id,project_id,source_url,status) VALUES($1,$2,'https://www.instagram.com/reel/qa','BLOCKED_SOURCE_ACCESS')",[company,project.id]);

  const connected=await call(`/api/company/${company}/integrations/apify/connect`,{method:'POST',headers:auth,body:JSON.stringify({token:'apify-test-token-123456'})});
  assert.equal(connected.connected,true);
  assert.equal(connected.resumedLinkLaunches,1);

  const j=(await db.query('SELECT status,last_error FROM jobs WHERE id=$1',[job.id])).rows[0];
  assert.equal(j.status,'QUEUED');
  assert.equal(j.last_error,null);
  const step=(await db.query('SELECT status FROM job_steps WHERE job_id=$1 AND step_type=$2',[job.id,'SOURCE_CAPTURE'])).rows[0];
  assert.equal(step.status,'PENDING');
  const source=(await db.query('SELECT status,error FROM reference_sources WHERE project_id=$1',[project.id])).rows[0];
  assert.equal(source.status,'PENDING_CAPTURE');
  assert.equal(actorChecks,1);

  console.log('APIFY MODULE QA PASSED');
  console.log(JSON.stringify({connected:true,resumedSameJob:true,sourceCaptureRequeued:true,actorChecks},null,2));
}finally{
  await db.end();child.kill('SIGTERM');await new Promise(r=>server.close(r));
}
