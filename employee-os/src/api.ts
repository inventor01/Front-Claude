import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool,tx } from './db.js';
import { hashPassword,verifyPassword,signSession,requireUser,requireCompany } from './auth.js';
import { commandCenterHtml } from './ui.js';
import { ensureAcademyDefaults,ingestTrainingSource,discoverTools,recommendVerificationTools,getEmployeeIntelligenceContext } from './academy.js';
import { connectShopify,disconnectShopify,shopifyStatus,verifyShopifyDraftWrite } from './shopify-executor.js';
import { compileSkill,testSkill } from './skills-engine.js';
import { connectCJ,disconnectCJ,cjStatus,searchCJ,mapCandidateToCJ } from './cj-executor.js';
import { connectApify,disconnectApify,apifyStatus,connectOpenAI,disconnectOpenAI,openAIStatus } from './source-intel.js';
import { connectRunway,disconnectRunway,runwayStatus } from './runway-executor.js';
import { connectFront,disconnectFront,frontStatus,connectAyrshare,disconnectSocial,socialStatus,connectResend,disconnectEmail,emailStatus,connectJina,disconnectSearch,searchStatus } from './external-connections.js';

const app=Fastify({logger:true});

async function resumeBlockedJobsForConnection(companyId:string,provider:'SHOPIFY'|'CJ'|'RUNWAY'|'SOCIAL_PUBLISHER'|'EMAIL'){
  const map={
    SHOPIFY:{jobType:'STORE_BUILD',stepType:'EXTERNAL_HANDOFF'},
    CJ:{jobType:'STORE_BUILD',stepType:'SHOPIFY_EXECUTE'},
    RUNWAY:{jobType:'CREATIVE_PRODUCTION',stepType:'RENDER_HANDOFF'},
    SOCIAL_PUBLISHER:{jobType:'DISTRIBUTION_PLANNING',stepType:'PUBLISH_HANDOFF'},
    EMAIL:{jobType:'SUPPORT_CASE',stepType:'SUPPORT_SEND_HANDOFF'}
  } as const;
  const target=map[provider];
  const rows=await pool.query(`SELECT j.id job_id,j.work_order_id,js.id step_id
    FROM jobs j JOIN job_steps js ON js.job_id=j.id AND js.step_type=$3
    WHERE j.company_id=$1 AND j.job_type=$2
      AND j.status IN ('BLOCKED','FAILED')
      AND js.status IN ('BLOCKED','FAILED','WAITING')
    ORDER BY j.updated_at DESC LIMIT 50`,[companyId,target.jobType,target.stepType]);
  for(const row of rows.rows){
    await pool.query(`UPDATE job_steps SET status='PENDING',last_error=NULL,updated_at=now() WHERE id=$1`,[row.step_id]);
    await pool.query(`UPDATE jobs SET status='QUEUED',last_error=NULL,scheduled_for=now(),retry_count=0,
      lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[row.job_id]);
    await pool.query(`UPDATE work_orders SET status='READY',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[row.work_order_id]);
    await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'JOB_RESUMED_AFTER_CONNECTION',$2)`,[
      companyId,JSON.stringify({provider,jobId:row.job_id,workOrderId:row.work_order_id,stepType:target.stepType})
    ]);
  }
  return rows.rowCount;
}

async function resumeBlockedLinkLaunches(companyId:string,stage:'SOURCE_CAPTURE'|'SOURCE_ANALYSIS'){
  const stepType=stage;
  const blockedSourceStatus=stage==='SOURCE_CAPTURE'?'BLOCKED_SOURCE_ACCESS':'BLOCKED_ANALYSIS';
  const rows=await pool.query(`SELECT j.id job_id,j.work_order_id,j.project_id,js.id step_id,rs.id source_id
    FROM jobs j
    JOIN job_steps js ON js.job_id=j.id AND js.step_type=$2
    JOIN reference_sources rs ON rs.project_id=j.project_id AND rs.company_id=j.company_id
    WHERE j.company_id=$1 AND j.job_type='LINK_PRODUCT_RESEARCH'
      AND j.status IN ('BLOCKED','FAILED')
      AND js.status IN ('BLOCKED','FAILED','WAITING')
      AND rs.status=$3`,[companyId,stepType,blockedSourceStatus]);
  for(const row of rows.rows){
    await pool.query(`UPDATE job_steps SET status='PENDING',last_error=NULL,updated_at=now()
      WHERE id=$1`,[row.step_id]);
    await pool.query(`UPDATE jobs SET status='QUEUED',last_error=NULL,scheduled_for=now(),
      retry_count=0,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[row.job_id]);
    await pool.query(`UPDATE work_orders SET status='READY',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[row.work_order_id]);
    await pool.query(`UPDATE reference_sources SET status=$2,error=NULL,updated_at=now() WHERE id=$1`,[
      row.source_id,stage==='SOURCE_CAPTURE'?'PENDING_CAPTURE':'CAPTURED'
    ]);
    await pool.query(`UPDATE link_launches SET status=$2,updated_at=now() WHERE project_id=$1`,[
      row.project_id,stage
    ]);
    await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'LINK_LAUNCH_RESUMED',$2)`,[
      companyId,JSON.stringify({projectId:row.project_id,jobId:row.job_id,stage})
    ]);
  }
  return rows.rowCount;
}
await app.register(cors,{origin:true});
app.get('/health',async()=>({ok:true,service:'employee-os-api',time:new Date().toISOString()}));
app.get('/',async(_req,reply)=>reply.type('text/html; charset=utf-8').send(commandCenterHtml()));

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
  }catch(e:unknown){
    const code=typeof e==='object'&&e!==null&&'code' in e?String((e as {code?:unknown}).code||''):'';
    if(code==='23505')return reply.code(409).send({error:'Account already exists'});
    throw e;
  }
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
  const userId=await requireUser(req), {companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const [employees,objectives,projects,work,approvals,events,candidates,storePackages,creativePackages,distributionPackages,supportCases,issuePatterns,toolConnections,supplierMappings,fulfillmentOrders,referenceSources,linkLaunches]=await Promise.all([
    pool.query('SELECT * FROM employees WHERE company_id=$1 ORDER BY created_at',[companyId]),
    pool.query('SELECT * FROM objectives WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20',[companyId]),
    pool.query('SELECT * FROM projects WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20',[companyId]),
    pool.query('SELECT * FROM work_orders WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM approvals WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM events WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM product_candidates WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM store_packages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM creative_packages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM distribution_packages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM support_cases WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM issue_patterns WHERE company_id=$1 ORDER BY last_seen_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT id,tool_id,provider,risk_class,status,metadata,updated_at FROM tool_connections WHERE company_id=$1 ORDER BY provider',[companyId]),
    pool.query('SELECT * FROM supplier_product_mappings WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM fulfillment_orders WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM reference_sources WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM link_launches WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 100',[companyId])
  ]);
  return {employees:employees.rows,objectives:objectives.rows,projects:projects.rows,workOrders:work.rows,approvals:approvals.rows,events:events.rows,productCandidates:candidates.rows,storePackages:storePackages.rows,creativePackages:creativePackages.rows,distributionPackages:distributionPackages.rows,supportCases:supportCases.rows,issuePatterns:issuePatterns.rows,toolConnections:toolConnections.rows,supplierMappings:supplierMappings.rows,fulfillmentOrders:fulfillmentOrders.rows,referenceSources:referenceSources.rows,linkLaunches:linkLaunches.rows};
});
app.get('/api/company/:companyId/execution',async req=>{
  const userId=await requireUser(req), {companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const [jobs,steps,evidence,messages]=await Promise.all([
    pool.query('SELECT id,project_id,work_order_id,employee_slug,job_type,status,priority,scheduled_for,lease_expires_at,attempt_count,retry_count,max_attempts,last_error,created_at,updated_at FROM jobs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT id,job_id,sequence,step_type,status,input,output,evidence_refs,last_error,attempt_history,created_at,updated_at FROM job_steps WHERE company_id=$1 ORDER BY created_at DESC,sequence ASC LIMIT 500',[companyId]),
    pool.query('SELECT id,project_id,work_order_id,employee_slug,evidence_type,source_type,source_name,source_url,external_id,content_summary,confidence,verification_status,captured_at FROM evidence WHERE company_id=$1 ORDER BY captured_at DESC LIMIT 200',[companyId]),
    pool.query('SELECT id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,evidence_refs,authority_context,payload,created_at,consumed_at FROM employee_messages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200',[companyId])
  ]);
  return {jobs:jobs.rows,steps:steps.rows,evidence:evidence.rows,messages:messages.rows};
});

app.get('/api/company/:companyId/academy',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  await ensureAcademyDefaults(companyId);
  const [profiles,sources,lessons,tools,discoveries,claims,skills,skillTests]=await Promise.all([
    pool.query('SELECT * FROM reasoning_profiles WHERE company_id=$1 ORDER BY employee_slug',[companyId]),
    pool.query(`SELECT id,employee_slug,source_type,title,source_url,source_author,source_quality,status,tags,ingest_metadata,created_at,updated_at
      FROM training_sources WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200`,[companyId]),
    pool.query(`SELECT l.id,l.source_id,l.employee_slug,l.lesson_type,l.principle,l.applicability,l.confidence,l.status,l.created_at,s.title source_title,s.source_url,s.source_quality
      FROM training_lessons l JOIN training_sources s ON s.id=l.source_id
      WHERE l.company_id=$1 ORDER BY l.created_at DESC LIMIT 500`,[companyId]),
    pool.query('SELECT * FROM tool_catalog WHERE company_id=$1 ORDER BY verification_grade,name',[companyId]),
    pool.query('SELECT * FROM tool_discovery_runs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[companyId]),
    pool.query('SELECT * FROM verification_claims WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200',[companyId]),
    pool.query('SELECT * FROM skill_definitions WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 200',[companyId]),
    pool.query('SELECT * FROM skill_test_runs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200',[companyId])
  ]);
  return {profiles:profiles.rows,sources:sources.rows,lessons:lessons.rows,tools:tools.rows,discoveries:discoveries.rows,claims:claims.rows,skills:skills.rows,skillTests:skillTests.rows};
});

app.get('/api/company/:companyId/academy/employees/:employeeSlug/context',async req=>{
  const userId=await requireUser(req),{companyId,employeeSlug}=req.params as {companyId:string;employeeSlug:string}; await requireCompany(userId,companyId);
  const exists=await pool.query('SELECT 1 FROM employees WHERE company_id=$1 AND slug=$2',[companyId,employeeSlug]);
  if(!exists.rowCount)throw Object.assign(new Error('Employee not found'),{statusCode:404});
  return getEmployeeIntelligenceContext(companyId,employeeSlug);
});

app.post('/api/company/:companyId/academy/sources',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({
    employeeSlug:z.string().min(1).max(60).nullable().default(null),
    url:z.string().url().max(2000).optional(),
    text:z.string().max(180000).optional(),
    title:z.string().max(240).optional(),
    tags:z.array(z.string().max(60)).max(20).default([])
  }).refine((value)=>Boolean(value.url||value.text),{message:'Provide a URL or training text'}).parse(req.body);
  const result=await ingestTrainingSource({
    companyId,userId,employeeSlug:body.employeeSlug,url:body.url,text:body.text,title:body.title,tags:body.tags
  });
  return reply.code(201).send(result);
});

app.post('/api/company/:companyId/academy/sources/:sourceId/status',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,sourceId}=req.params as {companyId:string;sourceId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({status:z.enum(['ACTIVE','PAUSED','REJECTED'])}).parse(req.body);
  const r=await pool.query('UPDATE training_sources SET status=$3,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING id,status',[sourceId,companyId,body.status]);
  if(!r.rowCount)return reply.code(404).send({error:'Training source not found'});
  await pool.query('UPDATE training_lessons SET status=$3,updated_at=now() WHERE source_id=$1 AND company_id=$2',[sourceId,companyId,body.status==='ACTIVE'?'ACTIVE':'PAUSED']);
  return r.rows[0];
});

app.put('/api/company/:companyId/academy/employees/:employeeSlug/reasoning',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,employeeSlug}=req.params as {companyId:string;employeeSlug:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  await ensureAcademyDefaults(companyId);
  const body=z.object({
    firstPrinciples:z.boolean().default(true),
    forwardHorizonSteps:z.number().int().min(1).max(12).default(3),
    uncertaintyPolicy:z.enum(['NEVER_ASSUME','STATE_ASSUMPTIONS','BEST_EFFORT']).default('NEVER_ASSUME'),
    learningPolicy:z.string().min(3).max(200).default('LEARN_FROM_BEST_AVAILABLE_EVIDENCE'),
    operatingPrinciples:z.array(z.string().min(5).max(1000)).max(30),
    verificationPolicy:z.record(z.string(),z.unknown())
  }).parse(req.body);
  const exists=await pool.query('SELECT 1 FROM employees WHERE company_id=$1 AND slug=$2',[companyId,employeeSlug]);
  if(!exists.rowCount)return reply.code(404).send({error:'Employee not found'});
  const r=await pool.query(`UPDATE reasoning_profiles SET first_principles=$3,forward_horizon_steps=$4,
    uncertainty_policy=$5,learning_policy=$6,operating_principles=$7,verification_policy=$8,updated_at=now()
    WHERE company_id=$1 AND employee_slug=$2 RETURNING *`,[
    companyId,employeeSlug,body.firstPrinciples,body.forwardHorizonSteps,body.uncertaintyPolicy,body.learningPolicy,
    JSON.stringify(body.operatingPrinciples),JSON.stringify(body.verificationPolicy)
  ]);
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'REASONING_PROFILE_UPDATED',$2)`,[
    companyId,JSON.stringify({employeeSlug,updatedBy:userId,forwardHorizonSteps:body.forwardHorizonSteps,uncertaintyPolicy:body.uncertaintyPolicy})
  ]);
  return r.rows[0];
});

app.post('/api/company/:companyId/academy/tools/discover',async(req)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const body=z.object({claimType:z.string().min(2).max(120),claimDescription:z.string().min(5).max(1000)}).parse(req.body);
  return discoverTools(companyId,body.claimType,body.claimDescription);
});

app.post('/api/company/:companyId/academy/claims',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const body=z.object({
    employeeSlug:z.string().min(1).max(60),
    claimType:z.string().min(2).max(120),
    claimText:z.string().min(5).max(2000),
    desiredGrade:z.enum(['VERIFIED_FIRST_PARTY','VERIFIED_PUBLIC_RECORD','CORROBORATED','ESTIMATE','SIGNAL']).default('VERIFIED_FIRST_PARTY'),
    projectId:z.string().uuid().optional(),
    workOrderId:z.string().uuid().optional()
  }).parse(req.body);
  const recommended=await recommendVerificationTools(companyId,body.claimType);
  const selected=recommended[0]||null;
  const status=selected?'READY_TO_VERIFY':'NEEDS_TOOL_DISCOVERY';
  const r=await pool.query(`INSERT INTO verification_claims(
    company_id,project_id,work_order_id,employee_slug,claim_type,claim_text,desired_grade,status,selected_tool_id,result_summary
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[
    companyId,body.projectId||null,body.workOrderId||null,body.employeeSlug,body.claimType,body.claimText,body.desiredGrade,
    status,selected?.tool_id||null,
    selected?`Recommended ${selected.name} at evidence grade ${selected.verification_grade}. Do not report a stronger claim than the tool can support.`:
      'No known verification tool matched. Run tool discovery before making the claim.'
  ]);
  return reply.code(201).send({claim:r.rows[0],recommended});
});

app.post('/api/company/:companyId/academy/skills/compile',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({
    employeeSlug:z.string().min(1).max(60).nullable().default(null),
    name:z.string().min(3).max(160),
    purpose:z.string().min(10).max(2000),
    sourceIds:z.array(z.string().uuid()).max(50).default([])
  }).parse(req.body);
  const result=await compileSkill({
    companyId,userId,employeeSlug:body.employeeSlug,name:body.name,purpose:body.purpose,sourceIds:body.sourceIds
  });
  return reply.code(201).send(result);
});

app.post('/api/company/:companyId/academy/skills/:skillId/test',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,skillId}=req.params as {companyId:string;skillId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return testSkill(companyId,skillId);
});

app.get('/api/company/:companyId/integrations/shopify',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return shopifyStatus(companyId);
});

app.post('/api/company/:companyId/integrations/shopify/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({
    storeDomain:z.string().min(5).max(255),
    accessToken:z.string().min(10).max(500)
  }).parse(req.body);
  const result=await connectShopify({companyId,storeDomain:body.storeDomain,accessToken:body.accessToken});
  const resumed=await resumeBlockedJobsForConnection(companyId,'SHOPIFY');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[
    companyId,JSON.stringify({provider:'SHOPIFY',storeDomain:result.shop.myshopifyDomain,primaryDomain:result.shop.primaryDomain?.url||null,resumedJobs:resumed})
  ]);
  return reply.code(201).send({resumedJobs:resumed,
    connected:true,
    shop:result.shop,
    publication:result.onlineStorePublication,
    connection:{id:result.connection.id,status:result.connection.status,metadata:result.connection.metadata}
  });
});

app.post('/api/company/:companyId/integrations/shopify/verify',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const result=await verifyShopifyDraftWrite(companyId);
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'SHOPIFY_RELEASE_GATE_VERIFIED',$2)`,[
    companyId,JSON.stringify({draftProductId:result.draftProduct.id,status:result.draftProduct.status,verifiedAt:result.verifiedAt})
  ]);
  return reply.code(200).send(result);
});

app.delete('/api/company/:companyId/integrations/shopify',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectShopify(companyId);
});

app.get('/api/company/:companyId/integrations/cj',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return cjStatus(companyId);
});

app.post('/api/company/:companyId/integrations/cj/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({apiKey:z.string().min(10).max(500)}).parse(req.body);
  const result=await connectCJ({companyId,apiKey:body.apiKey});
  const resumed=await resumeBlockedJobsForConnection(companyId,'CJ');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[
    companyId,JSON.stringify({provider:'CJ',openId:result.openId,resumedJobs:resumed})
  ]);
  return reply.code(201).send({connected:true,connection:result.connection,resumedJobs:resumed});
});

app.delete('/api/company/:companyId/integrations/cj',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectCJ(companyId);
});

app.get('/api/company/:companyId/integrations/cj/search',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const query=z.object({q:z.string().min(2).max(200)}).parse(req.query);
  return {products:await searchCJ(companyId,query.q)};
});

app.post('/api/company/:companyId/candidates/:candidateId/supplier-map',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,candidateId}=req.params as {companyId:string;candidateId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const result=await mapCandidateToCJ(companyId,candidateId);
  return reply.code(result.status==='NEEDS_REVIEW'?202:201).send(result);
});

app.get('/api/company/:companyId/integrations/apify',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return apifyStatus(companyId);
});
app.post('/api/company/:companyId/integrations/apify/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({token:z.string().min(10).max(1000)}).parse(req.body);
  const result=await connectApify({companyId,token:body.token});
  const resumed=await resumeBlockedLinkLaunches(companyId,'SOURCE_CAPTURE');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[
    companyId,JSON.stringify({provider:'APIFY',purpose:'SOCIAL_REFERENCE_CAPTURE',resumedLinkLaunches:resumed})
  ]);
  return reply.code(201).send({...result,resumedLinkLaunches:resumed});
});
app.delete('/api/company/:companyId/integrations/apify',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectApify(companyId);
});

app.get('/api/company/:companyId/integrations/openai',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return openAIStatus(companyId);
});
app.post('/api/company/:companyId/integrations/openai/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({apiKey:z.string().min(10).max(1000)}).parse(req.body);
  const result=await connectOpenAI({companyId,apiKey:body.apiKey});
  const resumed=await resumeBlockedLinkLaunches(companyId,'SOURCE_ANALYSIS');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[
    companyId,JSON.stringify({provider:'OPENAI',purpose:'MULTIMODAL_REFERENCE_ANALYSIS',model:result.model,resumedLinkLaunches:resumed})
  ]);
  return reply.code(201).send({...result,resumedLinkLaunches:resumed});
});
app.delete('/api/company/:companyId/integrations/openai',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectOpenAI(companyId);
});

app.get('/api/company/:companyId/integrations/runway',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return runwayStatus(companyId);
});
app.post('/api/company/:companyId/integrations/runway/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({
    apiSecret:z.string().min(10).max(1000),
    model:z.string().min(2).max(80).default('gen4.5')
  }).parse(req.body);
  const result=await connectRunway({companyId,apiSecret:body.apiSecret,model:body.model});
  const resumed=await resumeBlockedJobsForConnection(companyId,'RUNWAY');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[
    companyId,JSON.stringify({provider:'RUNWAY',purpose:'CREATIVE_VIDEO_RENDERING',model:body.model,resumedJobs:resumed})
  ]);
  return reply.code(201).send({...result,resumedJobs:resumed});
});
app.delete('/api/company/:companyId/integrations/runway',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectRunway(companyId);
});

app.post('/api/company/:companyId/link-launches/:projectId/retry-source',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,projectId}=req.params as {companyId:string;projectId:string};
  await requireCompany(userId,companyId);
  const source=await pool.query(`SELECT * FROM reference_sources WHERE company_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 1`,[
    companyId,projectId
  ]);
  if(!source.rowCount)return reply.code(404).send({error:'Reference source not found'});
  const status=String(source.rows[0].status||'');
  const stage=status==='BLOCKED_ANALYSIS'?'SOURCE_ANALYSIS':'SOURCE_CAPTURE';
  if(stage==='SOURCE_CAPTURE'&&String(source.rows[0].provider)==='INSTAGRAM'){
    const apify=await pool.query(`SELECT 1 FROM tool_connections WHERE company_id=$1 AND provider='APIFY' AND status='CONNECTED' LIMIT 1`,[companyId]);
    if(!apify.rowCount)return reply.code(409).send({error:'Connect Social reference capture in Connections first.'});
  }
  if(stage==='SOURCE_ANALYSIS'){
    const openai=await pool.query(`SELECT 1 FROM tool_connections WHERE company_id=$1 AND provider='OPENAI' AND status='CONNECTED' LIMIT 1`,[companyId]);
    if(!openai.rowCount)return reply.code(409).send({error:'Connect Multimodal reference analysis in Connections first.'});
  }
  const job=await pool.query(`SELECT j.id,j.work_order_id,js.id step_id
    FROM jobs j JOIN job_steps js ON js.job_id=j.id AND js.step_type=$3
    WHERE j.company_id=$1 AND j.project_id=$2 AND j.job_type='LINK_PRODUCT_RESEARCH'
    ORDER BY j.created_at DESC LIMIT 1`,[companyId,projectId,stage]);
  if(!job.rowCount)return reply.code(404).send({error:'Link-to-Launch source job not found'});
  await pool.query(`UPDATE job_steps SET status='PENDING',last_error=NULL,updated_at=now() WHERE id=$1`,[job.rows[0].step_id]);
  await pool.query(`UPDATE jobs SET status='QUEUED',last_error=NULL,scheduled_for=now(),retry_count=0,
    lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.rows[0].id]);
  await pool.query(`UPDATE work_orders SET status='READY',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.rows[0].work_order_id]);
  await pool.query(`UPDATE reference_sources SET status=$3,error=NULL,updated_at=now() WHERE company_id=$1 AND project_id=$2`,[
    companyId,projectId,stage==='SOURCE_CAPTURE'?'PENDING_CAPTURE':'CAPTURED'
  ]);
  await pool.query(`UPDATE link_launches SET status=$3,updated_at=now() WHERE company_id=$1 AND project_id=$2`,[
    companyId,projectId,stage
  ]);
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'LINK_LAUNCH_MANUAL_RETRY',$2)`,[
    companyId,JSON.stringify({projectId,jobId:job.rows[0].id,stage})
  ]);
  return reply.code(202).send({requeued:true,stage,jobId:job.rows[0].id});
});

app.post('/api/company/:companyId/ventures/from-link',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const body=z.object({
    url:z.string().url().max(2000),
    constraints:z.array(z.string().max(500)).max(30).default([]),
    budgetCents:z.number().int().min(0).max(100000000).nullable().default(null)
  }).parse(req.body);
  const result=await tx(async db=>{
    const statement='Turn this social-commerce reference into a verified, original ecommerce venture from product identification through sourcing, storefront, creative, distribution, and fulfillment.';
    const constraints=[
      'Never assume product identity, economics, stock, shipping, or performance.',
      'Model creative structure but do not copy exact footage, branding, script, music, or creator expression.',
      'No spending or publishing without the required owner approval.',
      ...body.constraints
    ];
    const objective=await db.query(`INSERT INTO objectives(company_id,created_by,statement,constraints)
      VALUES($1,$2,$3,$4) RETURNING *`,[companyId,userId,statement,JSON.stringify(constraints)]);
    const project=await db.query(`INSERT INTO projects(company_id,objective_id,name,phase,status)
      VALUES($1,$2,'Link-to-Launch Venture','REFERENCE_INTELLIGENCE','ACTIVE') RETURNING *`,[companyId,objective.rows[0].id]);
    const source=await db.query(`INSERT INTO reference_sources(company_id,project_id,source_url,provider,status)
      VALUES($1,$2,$3,$4,'PENDING_CAPTURE')
      ON CONFLICT(company_id,source_url) DO UPDATE SET project_id=EXCLUDED.project_id,status='PENDING_CAPTURE',error=NULL,updated_at=now()
      RETURNING *`,[
      companyId,project.rows[0].id,body.url,
      new URL(body.url).hostname.toLowerCase().includes('instagram')?'INSTAGRAM':'WEB'
    ]);
    const launch=await db.query(`INSERT INTO link_launches(company_id,project_id,source_id,objective_id,status)
      VALUES($1,$2,$3,$4,'SOURCE_CAPTURE')
      ON CONFLICT(project_id) DO UPDATE SET source_id=EXCLUDED.source_id,status='SOURCE_CAPTURE',updated_at=now()
      RETURNING *`,[companyId,project.rows[0].id,source.rows[0].id,objective.rows[0].id]);
    const work=await db.query(`INSERT INTO work_orders(company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria)
      VALUES($1,$2,'ava','rowan','Identify the reference product and verify the opportunity','READY','MEDIUM',$3) RETURNING *`,[
      companyId,project.rows[0].id,JSON.stringify([
        'reference captured with provenance','product identified with explicit confidence','demand and supplier evidence verified',
        'economics remain explicit','creative reference retained for Maya','manager receives structured launch result'
      ])
    ]);
    const job=await db.query(`INSERT INTO jobs(company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key)
      VALUES($1,$2,$3,'rowan','LINK_PRODUCT_RESEARCH',$4,$5) RETURNING *`,[
      companyId,project.rows[0].id,work.rows[0].id,
      JSON.stringify({sourceId:source.rows[0].id,sourceUrl:body.url,statement,constraints,budgetCents:body.budgetCents}),
      `link-product-research:${project.rows[0].id}`
    ]);
    const steps=['SOURCE_CAPTURE','SOURCE_ANALYSIS','DISCOVERY','FRONT_SCAN','DEMAND_VALIDATION','SUPPLIER_VALIDATION','ECONOMICS','CONTENTABILITY','RISK_REVIEW','MANAGER_REVIEW'];
    for(let i=0;i<steps.length;i++)await db.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,input)
      VALUES($1,$2,$3,$4,$5)`,[companyId,job.rows[0].id,i+1,steps[i],JSON.stringify({sourceId:source.rows[0].id,sourceUrl:body.url})]);
    await db.query(`INSERT INTO employee_messages(company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload)
      VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','rowan',$4,'Identify product, preserve reference evidence, and return a sourced candidate',$5,$6)`,[
      companyId,project.rows[0].id,work.rows[0].id,statement,
      JSON.stringify({risk:'MEDIUM',spendAllowed:false,publishAllowed:false,sourceUrl:body.url}),
      JSON.stringify({jobId:job.rows[0].id,sourceId:source.rows[0].id})
    ]);
    await db.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'LINK_LAUNCH_CREATED',$2),($1,'JOB_QUEUED',$3)`,[
      companyId,JSON.stringify({linkLaunchId:launch.rows[0].id,projectId:project.rows[0].id,sourceId:source.rows[0].id,url:body.url}),
      JSON.stringify({jobId:job.rows[0].id,employee:'rowan'})
    ]);
    return {objective:objective.rows[0],project:project.rows[0],source:source.rows[0],linkLaunch:launch.rows[0],workOrder:work.rows[0],job:job.rows[0]};
  });
  return reply.code(202).send(result);
});

app.get('/api/company/:companyId/integrations/front',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return frontStatus(companyId);
});
app.post('/api/company/:companyId/integrations/front/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({baseUrl:z.string().url().max(1000),apiKey:z.string().min(8).max(1000)}).parse(req.body);
  const result=await connectFront({companyId,...body});
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[companyId,JSON.stringify({provider:'FRONT'})]);
  return reply.code(201).send(result);
});
app.delete('/api/company/:companyId/integrations/front',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectFront(companyId);
});

app.get('/api/company/:companyId/integrations/social',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return socialStatus(companyId);
});
app.post('/api/company/:companyId/integrations/social/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({apiKey:z.string().min(8).max(1000)}).parse(req.body);
  const result=await connectAyrshare({companyId,apiKey:body.apiKey});
  const resumed=await resumeBlockedJobsForConnection(companyId,'SOCIAL_PUBLISHER');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[companyId,JSON.stringify({provider:'SOCIAL_PUBLISHER',name:'Ayrshare',resumedJobs:resumed})]);
  return reply.code(201).send({...result,resumedJobs:resumed});
});
app.delete('/api/company/:companyId/integrations/social',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectSocial(companyId);
});

app.get('/api/company/:companyId/integrations/email',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return emailStatus(companyId);
});
app.post('/api/company/:companyId/integrations/email/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({apiKey:z.string().min(8).max(1000),fromEmail:z.string().email().max(320)}).parse(req.body);
  const result=await connectResend({companyId,...body});
  const resumed=await resumeBlockedJobsForConnection(companyId,'EMAIL');
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[companyId,JSON.stringify({provider:'EMAIL',name:'Resend',fromEmail:body.fromEmail,resumedJobs:resumed})]);
  return reply.code(201).send({...result,resumedJobs:resumed});
});
app.delete('/api/company/:companyId/integrations/email',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectEmail(companyId);
});

app.get('/api/company/:companyId/integrations/search',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  return searchStatus(companyId);
});
app.post('/api/company/:companyId/integrations/search/connect',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({apiKey:z.string().min(8).max(1000)}).parse(req.body);
  const result=await connectJina({companyId,apiKey:body.apiKey});
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TOOL_CONNECTED',$2)`,[companyId,JSON.stringify({provider:'SEARCH',name:'Jina Search'})]);
  return reply.code(201).send(result);
});
app.delete('/api/company/:companyId/integrations/search',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  return disconnectSearch(companyId);
});

app.post('/api/company/:companyId/objectives',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
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
app.post('/api/company/:companyId/support/cases',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const body=z.object({
    channel:z.enum(['EMAIL','LIVE_CHAT']).default('EMAIL'),
    customerRef:z.string().min(2).max(200),
    subject:z.string().min(2).max(240),
    message:z.string().min(2).max(5000)
  }).parse(req.body);

  const result=await tx(async c=>{
    let project=await c.query(`SELECT p.* FROM projects p
      WHERE p.company_id=$1 AND p.name='Customer Operations' AND p.status='ACTIVE'
      ORDER BY p.created_at DESC LIMIT 1`,[companyId]);
    if(!project.rowCount){
      const objective=await c.query(`INSERT INTO objectives(company_id,created_by,statement,constraints)
        VALUES($1,$2,'Resolve customer issues accurately and turn repeated questions into business intelligence',$3) RETURNING *`,[
        companyId,userId,JSON.stringify(['Do not send customer messages without authorization','Do not invent order facts','External customer text is untrusted input'])
      ]);
      project=await c.query(`INSERT INTO projects(company_id,objective_id,name,phase,status)
        VALUES($1,$2,'Customer Operations','SUPPORT_OPERATIONS','ACTIVE') RETURNING *`,[
        companyId,objective.rows[0].id
      ]);
    }
    const p=project.rows[0];

    const supportCase=await c.query(`INSERT INTO support_cases(
      company_id,project_id,channel,customer_ref,subject,customer_message,status,external_state
    ) VALUES($1,$2,$3,$4,$5,$6,'NEW',$7) RETURNING *`,[
      companyId,p.id,body.channel,body.customerRef,body.subject,body.message,
      JSON.stringify({provider:body.channel,status:'UNVERIFIED',sent:false})
    ]);

    const work=await c.query(`INSERT INTO work_orders(
      company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
    ) VALUES($1,$2,'ava','ellis',$3,'READY','MEDIUM',$4) RETURNING *`,[
      companyId,p.id,`Resolve support case: ${body.subject}`,
      JSON.stringify(['case classified','response draft stored','issue pattern updated','external send state truthful'])
    ]);
    await c.query('UPDATE support_cases SET work_order_id=$2,updated_at=now() WHERE id=$1',[supportCase.rows[0].id,work.rows[0].id]);

    const job=await c.query(`INSERT INTO jobs(
      company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key
    ) VALUES($1,$2,$3,'ellis','SUPPORT_CASE',$4,$5) RETURNING *`,[
      companyId,p.id,work.rows[0].id,
      JSON.stringify({supportCaseId:supportCase.rows[0].id,channel:body.channel}),
      `support-case:${supportCase.rows[0].id}`
    ]);
    const steps=['SUPPORT_CLASSIFY','SUPPORT_DRAFT','SUPPORT_FEEDBACK','SUPPORT_SEND_HANDOFF','SUPPORT_SEND_EXECUTE'];
    for(let i=0;i<steps.length;i++){
      await c.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,input)
        VALUES($1,$2,$3,$4,$5)`,[
        companyId,job.rows[0].id,i+1,steps[i],JSON.stringify({supportCaseId:supportCase.rows[0].id})
      ]);
    }
    await c.query(`INSERT INTO employee_messages(
      company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
      authority_context,payload
    ) VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','ellis',$4,'Classify, draft, learn, and resolve within authority',$5,$6)`,[
      companyId,p.id,work.rows[0].id,`Resolve customer case: ${body.subject}`,
      JSON.stringify({customerContactAllowed:false,spendAllowed:false}),
      JSON.stringify({jobId:job.rows[0].id,supportCaseId:supportCase.rows[0].id})
    ]);
    await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'CUSTOMER_CASE_CREATED',$2)`,[
      companyId,JSON.stringify({supportCaseId:supportCase.rows[0].id,jobId:job.rows[0].id,channel:body.channel})
    ]);
    return {supportCase:supportCase.rows[0],project:p,workOrder:work.rows[0],job:job.rows[0]};
  });
  return reply.code(202).send(result);
});

app.get('/api/company/:companyId/briefing',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const [projects,approvals,blocked,events,candidates,messages]=await Promise.all([
    pool.query(`SELECT id,name,phase,status,updated_at FROM projects WHERE company_id=$1 AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 20`,[companyId]),
    pool.query(`SELECT id,project_id,work_order_id,action_type,reason,risk,cost_cents,status,created_at FROM approvals WHERE company_id=$1 AND status='PENDING' ORDER BY created_at`,[companyId]),
    pool.query(`SELECT id,project_id,assigned_employee_slug,objective,status,blockers,updated_at FROM work_orders WHERE company_id=$1 AND status IN ('BLOCKED','BLOCKED_EXTERNAL_AUTH','FAILED','NEEDS_APPROVAL','PARTIAL') ORDER BY updated_at DESC LIMIT 30`,[companyId]),
    pool.query(`SELECT type,payload,created_at FROM events WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20`,[companyId]),
    pool.query(`SELECT id,project_id,name,status,score,confidence,contentability_score,updated_at FROM product_candidates WHERE company_id=$1 ORDER BY updated_at DESC LIMIT 20`,[companyId]),
    pool.query(`SELECT id,type,from_employee_slug,to_employee_slug,objective,required_output,created_at FROM employee_messages WHERE company_id=$1 AND consumed_at IS NULL ORDER BY created_at LIMIT 30`,[companyId])
  ]);
  return {
    generatedAt:new Date().toISOString(),
    activeProjects:projects.rows,
    decisionsNeeded:approvals.rows,
    attention:blocked.rows,
    latestCandidates:candidates.rows,
    unconsumedMessages:messages.rows,
    recentEvents:events.rows
  };
});

app.get('/api/company/:companyId/memories',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string}; await requireCompany(userId,companyId);
  const r=await pool.query(`SELECT * FROM memories WHERE company_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 200`,[companyId]);
  return {memories:r.rows};
});

app.post('/api/company/:companyId/memories',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as {companyId:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  const body=z.object({
    type:z.enum(['VERIFIED_FACT','EMPLOYEE_INTERPRETATION','LEARNED_PREFERENCE','HYPOTHESIS','LESSON']),
    subject:z.string().min(2).max(160),
    content:z.string().min(2).max(4000),
    source:z.string().max(500).optional(),
    confidence:z.enum(['LOW','MEDIUM','HIGH']).default('MEDIUM')
  }).parse(req.body);
  if(body.type==='VERIFIED_FACT'&&!body.source)return reply.code(400).send({error:'VERIFIED_FACT requires a source'});
  const r=await pool.query(`INSERT INTO memories(company_id,type,subject,content,source,confidence,created_by,last_verified_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $2='VERIFIED_FACT' THEN now() ELSE NULL END) RETURNING *`,
    [companyId,body.type,body.subject,body.content,body.source||null,body.confidence,`user:${userId}`]);
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'MEMORY_CREATED',$2)`,[
    companyId,JSON.stringify({memoryId:r.rows[0].id,type:body.type,subject:body.subject})
  ]);
  return reply.code(201).send(r.rows[0]);
});

app.post('/api/company/:companyId/approvals/:approvalId/:decision',async(req,reply)=>{
  const userId=await requireUser(req),{companyId,approvalId,decision}=req.params as {companyId:string;approvalId:string;decision:string};
  const membership=await requireCompany(userId,companyId);
  if(!['OWNER','ADMIN'].includes(membership.role))return reply.code(403).send({error:'Owner or admin permission required'});
  if(!['approve','reject'].includes(decision))return reply.code(400).send({error:'Invalid decision'});

  const result=await tx(async c=>{
    const a=await c.query('SELECT * FROM approvals WHERE id=$1 AND company_id=$2 FOR UPDATE',[approvalId,companyId]);
    if(!a.rowCount)throw Object.assign(new Error('Approval not found'),{statusCode:404});
    const approval=a.rows[0];
    if(approval.status!=='PENDING')throw Object.assign(new Error('Approval already resolved'),{statusCode:409});

    const status=decision==='approve'?'APPROVED':'REJECTED';
    const updated=await c.query(`UPDATE approvals SET status=$3,resolved_at=now(),resolved_by=$4
      WHERE id=$1 AND company_id=$2 RETURNING *`,[approvalId,companyId,status,userId]);

    let handoff:{workOrder:unknown;job:unknown;candidateId:string}|null=null;
    if(approval.action_type==='PRODUCT_GATE'){
      const payload=approval.action_payload||{};
      const candidateId=String(payload.candidateId||'');
      const candidateR=await c.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2 FOR UPDATE',[candidateId,companyId]);
      if(!candidateR.rowCount)throw Object.assign(new Error('Product candidate not found'),{statusCode:409});
      const candidate=candidateR.rows[0];

      if(decision==='approve'){
        await c.query(`UPDATE product_candidates SET status='APPROVED',updated_at=now() WHERE id=$1`,[candidate.id]);
        if(approval.work_order_id){
          await c.query(`UPDATE work_orders SET status='DONE',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[approval.work_order_id]);
        }

        let storeWork=await c.query(`SELECT * FROM work_orders
          WHERE company_id=$1 AND project_id=$2 AND assigned_employee_slug='luca'
          AND objective LIKE 'Build brand and store%' ORDER BY created_at DESC LIMIT 1`,[companyId,approval.project_id]);
        if(!storeWork.rowCount){
          storeWork=await c.query(`INSERT INTO work_orders(
            company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
          ) VALUES($1,$2,'ava','luca',$3,'READY','MEDIUM',$4) RETURNING *`,[
            companyId,approval.project_id,`Build brand and store package for ${candidate.name}`,
            JSON.stringify(['brand/store brief persisted','mobile-first page architecture','claims trace to evidence','Shopify state is truthful','external publish requires authorization'])
          ]);
        }
        const work=storeWork.rows[0];

        let job=await c.query(`SELECT * FROM jobs WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1`,[
          companyId,`store-build:${candidate.id}`
        ]);
        if(!job.rowCount){
          job=await c.query(`INSERT INTO jobs(
            company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key
          ) VALUES($1,$2,$3,'luca','STORE_BUILD',$4,$5) RETURNING *`,[
            companyId,approval.project_id,work.id,
            JSON.stringify({candidateId:candidate.id,candidate:candidate.name,researchWorkOrderId:approval.work_order_id}),
            `store-build:${candidate.id}`
          ]);
          const steps=['BRAND_STRATEGY','STORE_BRIEF','STORE_QA','EXTERNAL_HANDOFF','SHOPIFY_EXECUTE'];
          for(let i=0;i<steps.length;i++){
            await c.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,input)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,sequence) DO NOTHING`,[
              companyId,job.rows[0].id,i+1,steps[i],JSON.stringify({candidateId:candidate.id,candidate:candidate.name})
            ]);
          }
          await c.query(`INSERT INTO employee_messages(
            company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
            evidence_refs,authority_context,payload
          ) VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','luca',$4,'Complete internal brand/store package',$5,$6,$7)`,[
            companyId,approval.project_id,work.id,`Build the brand and store system for ${candidate.name}`,
            JSON.stringify([]),JSON.stringify({risk:'MEDIUM',publishAllowed:false,spendAllowed:false,productGateApproved:true}),
            JSON.stringify({jobId:job.rows[0].id,candidateId:candidate.id})
          ]);
        }

        await c.query(`UPDATE projects SET phase='STORE_BUILD',updated_at=now() WHERE id=$1`,[approval.project_id]);
        await c.query(`INSERT INTO events(company_id,type,payload) VALUES
          ($1,'APPROVAL_GRANTED',$2),($1,'WORK_ASSIGNMENT_CREATED',$3)`,[
          companyId,JSON.stringify({approvalId,candidateId:candidate.id}),
          JSON.stringify({projectId:approval.project_id,workOrderId:work.id,jobId:job.rows[0].id,from:'ava',to:'luca'})
        ]);
        handoff={workOrder:work,job:job.rows[0],candidateId:candidate.id};
      }else{
        await c.query(`UPDATE product_candidates SET status='REJECTED',updated_at=now() WHERE id=$1`,[candidate.id]);
        if(approval.work_order_id){
          await c.query(`UPDATE work_orders SET status='PARTIAL',blockers=$2,updated_at=now() WHERE id=$1`,[
            approval.work_order_id,JSON.stringify(['Owner rejected product at product gate; research iteration required.'])
          ]);
        }
        await c.query(`UPDATE projects SET phase='RESEARCH_ITERATION',updated_at=now() WHERE id=$1`,[approval.project_id]);
        await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'APPROVAL_REJECTED',$2)`,[
          companyId,JSON.stringify({approvalId,candidateId:candidate.id})
        ]);
      }
    }else if(approval.action_type==='CJ_ORDER_PAYMENT'){
      const fulfillmentOrderId=String((approval.action_payload||{}).fulfillmentOrderId||'');
      const fulfillment=await c.query('SELECT * FROM fulfillment_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',[fulfillmentOrderId,companyId]);
      if(!fulfillment.rowCount)throw Object.assign(new Error('Fulfillment order not found'),{statusCode:409});
      await c.query('UPDATE fulfillment_orders SET status=$3,updated_at=now() WHERE id=$1 AND company_id=$2',[
        fulfillmentOrderId,companyId,decision==='approve'?'PAYMENT_APPROVED':'PAYMENT_REJECTED'
      ]);
      await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)`,[
        companyId,
        decision==='approve'?'FULFILLMENT_PAYMENT_APPROVED':'FULFILLMENT_PAYMENT_REJECTED',
        JSON.stringify({approvalId,fulfillmentOrderId,supplierOrderId:fulfillment.rows[0].supplier_order_id})
      ]);
    }else{
      if(approval.job_id){
        await c.query(`UPDATE jobs SET status=$2,scheduled_for=now(),last_error=NULL,updated_at=now() WHERE id=$1`,[
          approval.job_id,decision==='approve'?'QUEUED':'CANCELLED'
        ]);
      }
      if(approval.work_order_id){
        await c.query(`UPDATE work_orders SET status=$2,blockers=$3,updated_at=now() WHERE id=$1`,[
          approval.work_order_id,
          decision==='approve'?'IN_PROGRESS':'CANCELLED',
          JSON.stringify(decision==='approve'?[]:['Owner rejected requested external action.'])
        ]);
      }
      await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)`,[
        companyId,decision==='approve'?'APPROVAL_GRANTED':'APPROVAL_REJECTED',JSON.stringify({approvalId,actionType:approval.action_type})
      ]);
    }
    return {approval:updated.rows[0],handoff};
  });
  return result;
});
app.setErrorHandler((e,_req,reply)=>{
  const err=e as {statusCode?:number;message?:string};
  return reply.code(err.statusCode||400).send({error:err.message||'Request failed'});
});
const port=Number(process.env.PORT||3000); await app.listen({host:'0.0.0.0',port});
