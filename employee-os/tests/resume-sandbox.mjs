import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import pg from 'pg';
const {Pool}=pg;

const MOCK_PORT=4360,API_PORT=4361;
process.env.PROVIDER_TEST_MODE='1';
process.env.RUNWAY_TEST_BASE_URL=`http://127.0.0.1:${MOCK_PORT}`;

function json(res,status,payload){
  const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json'});res.end(body);
}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/',`http://127.0.0.1:${MOCK_PORT}`);
  if(req.method==='GET'&&u.pathname==='/v1/tasks/00000000-0000-0000-0000-000000000000')return json(res,404,{error:'not found'});
  return json(res,404,{error:'unhandled'});
});
await new Promise(r=>server.listen(MOCK_PORT,'127.0.0.1',r));

const child=spawn('node',['dist/api.js'],{env:{...process.env,PORT:String(API_PORT),PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
const wait=async(fn,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('timeout');};
await wait(async()=>{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`);return r.ok;});
const call=async(path,opts={})=>{const r=await fetch(`http://127.0.0.1:${API_PORT}${path}`,opts);const d=await r.json();if(!r.ok)throw new Error(d.error||String(r.status));return d;};

const reg=await call('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  email:`resume-${Date.now()}@example.test`,password:'Resume-QA-Password-123!',companyName:'Resume QA'
})});
const company=reg.company.id,token=reg.token,auth={authorization:'Bearer '+token,'content-type':'application/json'};
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
try{
  const member=await db.query('SELECT user_id FROM memberships WHERE company_id=$1',[company]);
  const objective=await db.query("INSERT INTO objectives(company_id,created_by,statement,constraints) VALUES($1,$2,'Resume QA','[]') RETURNING id",[company,member.rows[0].user_id]);
  const project=await db.query("INSERT INTO projects(company_id,objective_id,name,phase,status) VALUES($1,$2,'Resume Project','CREATIVE','ACTIVE') RETURNING id",[company,objective.rows[0].id]);
  const work=await db.query("INSERT INTO work_orders(company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria,blockers) VALUES($1,$2,'ava','maya','Render QA','BLOCKED_EXTERNAL_AUTH','MEDIUM','[]',$3) RETURNING id",[company,project.rows[0].id,JSON.stringify(['BLOCKED_EXTERNAL_AUTH'])]);
  const job=await db.query("INSERT INTO jobs(company_id,project_id,work_order_id,employee_slug,job_type,payload,status,idempotency_key,last_error) VALUES($1,$2,$3,'maya','CREATIVE_PRODUCTION','{}','BLOCKED',$4,'BLOCKED_EXTERNAL_AUTH: Creative rendering tool is not connected') RETURNING id",[company,project.rows[0].id,work.rows[0].id,`resume-qa-${Date.now()}`]);
  await db.query("INSERT INTO job_steps(company_id,job_id,sequence,step_type,status,output) VALUES($1,$2,1,'CREATIVE_STRATEGY','SUCCEEDED',$3),($1,$2,2,'RENDER_HANDOFF','BLOCKED',NULL)",[company,job.rows[0].id,JSON.stringify({preserve:'yes'})]);

  const connected=await call(`/api/company/${company}/integrations/runway/connect`,{method:'POST',headers:auth,body:JSON.stringify({apiSecret:'runway-resume-secret-123456',model:'gen4.5'})});
  assert.equal(connected.resumedJobs,1);

  const j=(await db.query('SELECT status,last_error FROM jobs WHERE id=$1',[job.rows[0].id])).rows[0];
  assert.equal(j.status,'QUEUED');assert.equal(j.last_error,null);
  const steps=(await db.query('SELECT step_type,status,output FROM job_steps WHERE job_id=$1 ORDER BY sequence',[job.rows[0].id])).rows;
  assert.equal(steps[0].status,'SUCCEEDED');assert.equal(steps[0].output.preserve,'yes');
  assert.equal(steps[1].status,'PENDING');
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs WHERE id=$1',[job.rows[0].id])).rows[0].n,1);

  console.log('RESUME SANDBOX QA PASSED');
  console.log(JSON.stringify({sameJob:true,upstreamPreserved:true,blockedStepRequeued:true,resumedJobs:connected.resumedJobs},null,2));
}finally{
  await db.end();child.kill('SIGTERM');await new Promise(r=>server.close(r));
}
