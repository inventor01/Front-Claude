import assert from 'node:assert/strict';
import pg from 'pg';
const {Pool}=pg;

const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const {processOneManagerMessage}=await import('../dist/manager.js');

try{
  const user=(await db.query(`INSERT INTO users(email,password_hash) VALUES($1,'qa-hash') RETURNING id`,[`handoff-${Date.now()}@example.test`])).rows[0];
  const company=(await db.query(`INSERT INTO companies(name) VALUES('Manager Handoff Dedupe QA') RETURNING id`)).rows[0];
  const objective=(await db.query(`INSERT INTO objectives(company_id,created_by,statement,constraints)
    VALUES($1,$2,'Verify manager handoff idempotency','[]'::jsonb) RETURNING id`,[company.id,user.id])).rows[0];
  const project=(await db.query(`INSERT INTO projects(company_id,objective_id,name,phase,status)
    VALUES($1,$2,'Dedupe Venture','CREATIVE','ACTIVE') RETURNING id`,[company.id,objective.id])).rows[0];

  const lucaWork=(await db.query(`INSERT INTO work_orders(
    company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
  ) VALUES($1,$2,'ava','luca','Build brand and store package for Hoodies','DONE','MEDIUM','[]'::jsonb) RETURNING id`,[
    company.id,project.id
  ])).rows[0];

  const candidate=(await db.query(`INSERT INTO product_candidates(
    company_id,project_id,work_order_id,name,status,score,confidence,discovery_mode,demand_score,
    marketplace_seen,supplier_seen,contentability_score,risk_flags,creative_angles,analysis
  ) VALUES($1,$2,$3,'Hoodies','APPROVED',80,'HIGH','QA',80,true,true,85,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb)
  RETURNING id`,[company.id,project.id,lucaWork.id])).rows[0];

  const store=(await db.query(`INSERT INTO store_packages(
    company_id,project_id,work_order_id,candidate_id,status,qa_result
  ) VALUES($1,$2,$3,$4,'READY_FOR_EXTERNAL',$5) RETURNING id`,[
    company.id,project.id,lucaWork.id,candidate.id,JSON.stringify({passed:true,checks:['qa']})
  ])).rows[0];

  for(let i=0;i<2;i++){
    await db.query(`INSERT INTO employee_messages(
      company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,payload
    ) VALUES($1,$2,$3,'WORK_RESULT','luca','ava','Store QA passed','Start creative production',$4)`,[
      company.id,project.id,lucaWork.id,JSON.stringify({storePackageId:store.id,candidateId:candidate.id})
    ]);
  }

  await Promise.all([processOneManagerMessage(),processOneManagerMessage()]);

  const mayaWork=await db.query(`SELECT * FROM work_orders WHERE company_id=$1 AND project_id=$2
    AND assigned_employee_slug='maya' AND objective LIKE 'Create launch creative system%'`,[company.id,project.id]);
  const creativeJobs=await db.query(`SELECT * FROM jobs WHERE company_id=$1 AND project_id=$2 AND job_type='CREATIVE_PRODUCTION'`,[
    company.id,project.id
  ]);
  const mayaAssignments=await db.query(`SELECT * FROM employee_messages WHERE company_id=$1 AND project_id=$2
    AND type='WORK_ASSIGNMENT' AND to_employee_slug='maya'`,[company.id,project.id]);
  assert.equal(mayaWork.rowCount,1,'duplicate Maya work orders were created');
  assert.equal(creativeJobs.rowCount,1,'duplicate creative jobs were created');
  assert.equal(mayaAssignments.rowCount,1,'duplicate Maya assignments were created');

  const creative=(await db.query(`INSERT INTO creative_packages(
    company_id,project_id,work_order_id,candidate_id,store_package_id,status,qa_result
  ) VALUES($1,$2,$3,$4,$5,'READY_FOR_RENDER',$6) RETURNING id`,[
    company.id,project.id,mayaWork.rows[0].id,candidate.id,store.id,JSON.stringify({passed:true,checks:['qa']})
  ])).rows[0];

  for(let i=0;i<2;i++){
    await db.query(`INSERT INTO employee_messages(
      company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,payload
    ) VALUES($1,$2,$3,'WORK_RESULT','maya','ava','Creative QA passed','Start distribution planning',$4)`,[
      company.id,project.id,mayaWork.rows[0].id,JSON.stringify({creativePackageId:creative.id,candidateId:candidate.id})
    ]);
  }

  await Promise.all([processOneManagerMessage(),processOneManagerMessage()]);

  const novaWork=await db.query(`SELECT * FROM work_orders WHERE company_id=$1 AND project_id=$2
    AND assigned_employee_slug='nova' AND objective LIKE 'Plan organic distribution%'`,[company.id,project.id]);
  const distributionJobs=await db.query(`SELECT * FROM jobs WHERE company_id=$1 AND project_id=$2 AND job_type='DISTRIBUTION_PLANNING'`,[
    company.id,project.id
  ]);
  const novaAssignments=await db.query(`SELECT * FROM employee_messages WHERE company_id=$1 AND project_id=$2
    AND type='WORK_ASSIGNMENT' AND to_employee_slug='nova'`,[company.id,project.id]);

  assert.equal(novaWork.rowCount,1,'duplicate Nova work orders were created');
  assert.equal(distributionJobs.rowCount,1,'duplicate distribution jobs were created');
  assert.equal(novaAssignments.rowCount,1,'duplicate Nova assignments were created');

  console.log('MANAGER HANDOFF DEDUPE QA PASSED');
  console.log(JSON.stringify({
    mayaWorkOrders:mayaWork.rowCount,
    creativeJobs:creativeJobs.rowCount,
    novaWorkOrders:novaWork.rowCount,
    distributionJobs:distributionJobs.rowCount
  },null,2));
}finally{
  await db.end();
}
