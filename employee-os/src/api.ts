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
app.get('/api/company/:companyId/briefing',async req=>{
  const userId=await requireUser(req),{companyId}=req.params as any; await requireCompany(userId,companyId);
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
  const userId=await requireUser(req),{companyId}=req.params as any; await requireCompany(userId,companyId);
  const r=await pool.query(`SELECT * FROM memories WHERE company_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 200`,[companyId]);
  return {memories:r.rows};
});

app.post('/api/company/:companyId/memories',async(req,reply)=>{
  const userId=await requireUser(req),{companyId}=req.params as any;
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
  const userId=await requireUser(req),{companyId,approvalId,decision}=req.params as any;
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

    let handoff:any=null;
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
          const steps=['BRAND_STRATEGY','STORE_BRIEF','STORE_QA','EXTERNAL_HANDOFF'];
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
    }else{
      if(approval.job_id){
        await c.query(`UPDATE jobs SET status=$2,scheduled_for=now(),updated_at=now() WHERE id=$1`,[
          approval.job_id,decision==='approve'?'QUEUED':'CANCELLED'
        ]);
      }
      await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)`,[
        companyId,decision==='approve'?'APPROVAL_GRANTED':'APPROVAL_REJECTED',JSON.stringify({approvalId})
      ]);
    }
    return {approval:updated.rows[0],handoff};
  });
  return result;
});
app.get('/internal/qa/module2',async(req,reply)=>{
  const q=req.query as any;
  const expected=process.env.QA_PROBE_TOKEN||'';
  if(!expected||q?.token!==expected)return reply.code(404).send({error:'Not found'});
  const base=`http://127.0.0.1:${process.env.PORT||3000}`;
  const email=`qa-module2-${Date.now()}@example.com`;
  const password=`Qa!${crypto.randomUUID()}Aa9`;
  const register=await fetch(`${base}/api/auth/register`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email,password,companyName:'Module 2 QA'})
  });
  const reg:any=await register.json();
  if(!register.ok)return reply.code(500).send({stage:'register',status:register.status,body:reg});
  const token=reg.token as string, companyId=reg.company.id as string;
  const objective=await fetch(`${base}/api/company/${companyId}/objectives`,{
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
    body:JSON.stringify({
      statement:'Find a promising organic dropshipping product and start a business around it. Prioritize products capable of supporting large amounts of TikTok and Instagram content. Do not spend money or publish anything without my approval.',
      constraints:['No spending without owner approval','No publishing without owner approval'],
      query:'car diffuser'
    })
  });
  const created:any=await objective.json();
  if(objective.status!==202)return reply.code(500).send({stage:'objective',status:objective.status,body:created});
  const jobId=created.job.id as string, workOrderId=created.workOrder.id as string;
  let state:any=null, execution:any=null;
  for(let i=0;i<15;i++){
    await new Promise(r=>setTimeout(r,2000));
    const [s,e]=await Promise.all([
      fetch(`${base}/api/company/${companyId}/state`,{headers:{authorization:`Bearer ${token}`}}),
      fetch(`${base}/api/company/${companyId}/execution`,{headers:{authorization:`Bearer ${token}`}})
    ]);
    state=await s.json(); execution=await e.json();
    const job=execution.jobs?.find((x:any)=>x.id===jobId);
    if(job&&['SUCCEEDED','BLOCKED','FAILED'].includes(job.status))break;
  }
  const job=execution?.jobs?.find((x:any)=>x.id===jobId)||null;
  const steps=(execution?.steps||[]).filter((x:any)=>x.job_id===jobId).sort((a:any,b:any)=>a.sequence-b.sequence);
  const work=(state?.workOrders||[]).find((x:any)=>x.id===workOrderId)||null;
  const candidate=(state?.productCandidates||[]).find((x:any)=>x.project_id===created.project.id)||null;
  const approval=(state?.approvals||[]).find((x:any)=>x.project_id===created.project.id&&x.action_type==='PRODUCT_GATE')||null;
  const message=(execution?.messages||[]).find((x:any)=>x.project_id===created.project.id&&x.type==='WORK_RESULT'&&x.from_employee_slug==='rowan'&&x.to_employee_slug==='ava')||null;
  const evidence=(execution?.evidence||[]).filter((x:any)=>x.project_id===created.project.id);
  const evidenceBySource=evidence.reduce((acc:any,x:any)=>{acc[x.source_type]=(acc[x.source_type]||0)+1;return acc;},{});
  return {
    passed:Boolean(
      objective.status===202 &&
      steps.length===8 &&
      steps.every((x:any)=>x.status==='SUCCEEDED') &&
      job?.status==='SUCCEEDED' &&
      candidate &&
      message &&
      !steps.some((x:any)=>x.status==='BLOCKED') &&
      ['LAUNCH_REVIEW','VERIFIED_CANDIDATE','INVESTIGATING','REJECTED'].includes(candidate.status)
    ),
    created:{objectiveHttp:objective.status,projectId:created.project.id,workOrderId,jobId},
    job:job&&{status:job.status,attemptCount:job.attempt_count,lastError:job.last_error},
    steps:steps.map((x:any)=>({sequence:x.sequence,type:x.step_type,status:x.status,lastError:x.last_error,outputStatus:x.output?.status||null})),
    workOrder:work&&{status:work.status,blockers:work.blockers},
    project:(state?.projects||[]).find((x:any)=>x.id===created.project.id)||null,
    candidate:candidate&&{
      name:candidate.name,status:candidate.status,score:candidate.score,confidence:candidate.confidence,
      demandScore:candidate.demand_score,marketplaceSeen:candidate.marketplace_seen,supplierSeen:candidate.supplier_seen,
      observedMarketPrice:candidate.observed_market_price,observedSourcePrice:candidate.observed_source_price,
      observedGrossMarginPct:candidate.observed_gross_margin_pct,contentabilityScore:candidate.contentability_score,
      riskFlags:candidate.risk_flags
    },
    evidenceBySource,
    workResult:Boolean(message),
    approval:approval&&{status:approval.status,actionType:approval.action_type,risk:approval.risk,costCents:approval.cost_cents},
    frontStep:steps.find((x:any)=>x.step_type==='FRONT_SCAN')||null
  };
});

app.setErrorHandler((e:any,_req,reply)=>reply.code(e.statusCode||400).send({error:e.message||'Request failed'}));
const port=Number(process.env.PORT||3000); await app.listen({host:'0.0.0.0',port});
