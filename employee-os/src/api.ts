import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool,tx } from './db.js';
import { hashPassword,verifyPassword,signSession,requireUser,requireCompany } from './auth.js';

const app=Fastify({logger:true});
await app.register(cors,{origin:true});
app.get('/health',async()=>({ok:true,service:'employee-os-api',time:new Date().toISOString()}));

app.post('/api/auth/register',async(req,reply)=>{
  const body=z.object({email:z.string().email(),password:z.string().min(12),companyName:z.string().min(2).max(100)}).parse(req.body);
  try{
    const result=await tx(async c=>{
      const hash=await hashPassword(body.password);
      const u=await c.query('INSERT INTO users(email,password_hash) VALUES(lower($1),$2) RETURNING id,email',[body.email,hash]);
      const company=await c.query('INSERT INTO companies(name) VALUES($1) RETURNING id,name',[body.companyName]);
      await c.query(`INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'OWNER')`,[u.rows[0].id,company.rows[0].id]);
      const employees=[
        ['ava','Ava','Dropshipping Venture Project Manager','Operations','Own objectives, delegation, blockers, approvals, and truthful completion.',null],
        ['rowan','Rowan','Product Research Specialist','Intelligence','Find evidence-backed products and state uncertainty honestly.','ava'],
        ['luca','Luca','Designer & Store Builder','Brand & Commerce','Turn approved products into conversion-ready brand/store work.','ava'],
        ['maya','Maya','Creative Director','Creative','Produce high-taste social-native creative systems.','ava'],
        ['nova','Nova','Organic Distribution Manager','Growth','Publish and iterate approved organic content.','ava'],
        ['ellis','Ellis','Customer Experience Rep','Customer Experience','Resolve customer issues and feed patterns back to the company.','ava']
      ];
      for(const e of employees)await c.query('INSERT INTO employees(company_id,slug,name,title,department,mission,manager_slug) VALUES($1,$2,$3,$4,$5,$6,$7)',[company.rows[0].id,...e]);
      return {user:u.rows[0],company:company.rows[0]};
    });
    return reply.code(201).send({...result,token:await signSession(result.user.id)});
  }catch(e:any){if(e?.code==='23505')return reply.code(409).send({error:'Account already exists'});throw e;}
});
app.post('/api/auth/login',async(req,reply)=>{
  const body=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);
  const r=await pool.query('SELECT id,email,password_hash FROM users WHERE email=lower($1)',[body.email]);
  if(!r.rowCount||!await verifyPassword(r.rows[0].password_hash,body.password))return reply.code(401).send({error:'Invalid credentials'});
  return {token:await signSession(r.rows[0].id),user:{id:r.rows[0].id,email:r.rows[0].email}};
});
app.get('/api/me',async req=>{
  const userId=await requireUser(req);
  const r=await pool.query(`SELECT u.id,u.email,m.company_id,m.role,c.name company_name FROM users u JOIN memberships m ON m.user_id=u.id JOIN companies c ON c.id=m.company_id WHERE u.id=$1`,[userId]);
  return {memberships:r.rows};
});
app.get('/api/company/:companyId/state',async req=>{
  const userId=await requireUser(req), {companyId}=req.params as any; await requireCompany(userId,companyId);
  const [employees,objectives,projects,work,approvals,events,candidates]=await Promise.all([
    pool.query('SELECT * FROM employees WHERE company_id=$1 ORDER BY created_at',[companyId]),
    pool.query('SELECT * FROM objectives WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20',[companyId]),
    pool.query('SELECT * FROM projects WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20',[companyId]),
    pool.query('SELECT * FROM work_orders WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM approvals WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM events WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM product_candidates WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId])
  ]);
  return {employees:employees.rows,objectives:objectives.rows,projects:projects.rows,workOrders:work.rows,approvals:approvals.rows,events:events.rows,productCandidates:candidates.rows};
});
app.get('/api/company/:companyId/execution',async req=>{
  const userId=await requireUser(req), {companyId}=req.params as any; await requireCompany(userId,companyId);
  const [jobs,steps,evidence,messages]=await Promise.all([
    pool.query('SELECT id,project_id,work_order_id,employee_slug,job_type,status,priority,scheduled_for,lease_expires_at,attempt_count,max_attempts,last_error,created_at,updated_at FROM jobs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT id,job_id,sequence,step_type,status,input,output,evidence_refs,last_error,attempt_history,created_at,updated_at FROM job_steps WHERE company_id=$1 ORDER BY created_at DESC,sequence ASC LIMIT 500',[companyId]),
    pool.query('SELECT id,project_id,work_order_id,employee_slug,evidence_type,source_type,source_name,source_url,external_id,content_summary,confidence,verification_status,captured_at FROM evidence WHERE company_id=$1 ORDER BY captured_at DESC LIMIT 200',[companyId]),
    pool.query('SELECT id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,evidence_refs,authority_context,created_at,consumed_at FROM employee_messages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200',[companyId])
  ]);
  return {jobs:jobs.rows,steps:steps.rows,evidence:evidence.rows,messages:messages.rows};
});

app.post('/api/company/:companyId/objectives',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as any; await requireCompany(userId,companyId);
  const body=z.object({statement:z.string().min(10),constraints:z.array(z.string()).default([]),query:z.string().default('')}).parse(req.body);
  const result=await tx(async c=>{
    const o=await c.query('INSERT INTO objectives(company_id,created_by,statement,constraints) VALUES($1,$2,$3,$4) RETURNING *',[companyId,userId,body.statement,JSON.stringify(body.constraints)]);
    const p=await c.query(`INSERT INTO projects(company_id,objective_id,name,phase) VALUES($1,$2,'Organic Dropshipping Venture','PRODUCT_RESEARCH') RETURNING *`,[companyId,o.rows[0].id]);
    const w=await c.query(`INSERT INTO work_orders(company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria) VALUES($1,$2,'ava','rowan','Find and verify an organic dropshipping product candidate','READY','LOW',$3) RETURNING *`,
      [companyId,p.rows[0].id,JSON.stringify(['social evidence collected','supplier/economics remain explicit','contentability evaluated','major risk stated','manager receives structured result'])]);
    const key=`product-research:${p.rows[0].id}`;
    const j=await c.query(`INSERT INTO jobs(company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key) VALUES($1,$2,$3,'rowan','PRODUCT_RESEARCH',$4,$5) RETURNING *`,
      [companyId,p.rows[0].id,w.rows[0].id,JSON.stringify({query:body.query,statement:body.statement,constraints:body.constraints}),key]);
    const steps=['DISCOVERY','FRONT_SCAN','DEMAND_VALIDATION','SUPPLIER_VALIDATION','ECONOMICS','CONTENTABILITY','RISK_REVIEW','MANAGER_REVIEW'];
    for(let i=0;i<steps.length;i++)await c.query('INSERT INTO job_steps(company_id,job_id,sequence,step_type,input) VALUES($1,$2,$3,$4,$5)',[companyId,j.rows[0].id,i+1,steps[i],JSON.stringify({objective:body.statement})]);
    await c.query(`INSERT INTO employee_messages(company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload) VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','rowan',$4,'Evidence-backed product research',$5,$6)`,
      [companyId,p.rows[0].id,w.rows[0].id,body.statement,JSON.stringify({risk:'LOW',spendAllowed:false,publishAllowed:false}),JSON.stringify({jobId:j.rows[0].id})]);
    await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'OBJECTIVE_CREATED',$2),($1,'JOB_QUEUED',$3)`,[companyId,JSON.stringify({objectiveId:o.rows[0].id,projectId:p.rows[0].id}),JSON.stringify({jobId:j.rows[0].id,employee:'rowan'})]);
    return {objective:o.rows[0],project:p.rows[0],workOrder:w.rows[0],job:j.rows[0]};
  });
  return reply.code(202).send(result);
});
app.post('/api/company/:companyId/approvals/:approvalId/:decision',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,approvalId,decision}=req.params as any; await requireCompany(userId,companyId);
  if(!['approve','reject'].includes(decision))return reply.code(400).send({error:'Invalid decision'});
  const r=await tx(async c=>{
    const a=await c.query('SELECT * FROM approvals WHERE id=$1 AND company_id=$2 FOR UPDATE',[approvalId,companyId]);
    if(!a.rowCount)throw Object.assign(new Error('Approval not found'),{statusCode:404});
    if(a.rows[0].status!=='PENDING')throw Object.assign(new Error('Approval already resolved'),{statusCode:409});
    const status=decision==='approve'?'APPROVED':'REJECTED';
    const u=await c.query('UPDATE approvals SET status=$3,resolved_at=now(),resolved_by=$4 WHERE id=$1 AND company_id=$2 RETURNING *',[approvalId,companyId,status,userId]);
    if(a.rows[0].job_id)await c.query(`UPDATE jobs SET status=$2,scheduled_for=now(),updated_at=now() WHERE id=$1`,[a.rows[0].job_id,decision==='approve'?'QUEUED':'CANCELLED']);
    await c.query('INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)',[companyId,decision==='approve'?'APPROVAL_GRANTED':'APPROVAL_REJECTED',JSON.stringify({approvalId})]);
    return u.rows[0];
  });
  return r;
});
app.setErrorHandler((e:any,_req,reply)=>reply.code(e.statusCode||400).send({error:e.message||'Request failed'}));
const port=Number(process.env.PORT||3000); await app.listen({host:'0.0.0.0',port});
