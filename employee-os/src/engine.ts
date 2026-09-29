import { pool,tx } from './db.js';
import { getCommerceOpportunities } from './front.js';
type JobRow={id:string;company_id:string;project_id:string;work_order_id:string;employee_slug:string;job_type:string;payload:any;status:string;attempt_count:number;max_attempts:number;lease_id:string|null};
const retryable=(m:string)=>/timeout|rate|temporar|connection|502|503|504/i.test(m);

export async function emitEvent(companyId:string,type:string,payload:unknown){await pool.query('INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)',[companyId,type,JSON.stringify(payload)]);}

export async function claimJob():Promise<JobRow|null>{
  return tx(async c=>{
    const r=await c.query(`SELECT * FROM jobs
      WHERE ((status IN ('QUEUED','RETRY_SCHEDULED')) OR (status='CLAIMED' AND lease_expires_at<now()))
      AND scheduled_for<=now()
      ORDER BY priority DESC,created_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1`);
    if(!r.rowCount)return null;
    const job=r.rows[0] as JobRow;
    const lease=crypto.randomUUID();
    const u=await c.query(`UPDATE jobs SET status='CLAIMED',lease_id=$2,lease_expires_at=now()+interval '2 minutes',
      attempt_count=attempt_count+1,updated_at=now() WHERE id=$1 RETURNING *`,[job.id,lease]);
    return u.rows[0] as JobRow;
  });
}
async function nextStep(jobId:string){
  const r=await pool.query(`SELECT * FROM job_steps WHERE job_id=$1 AND status IN ('PENDING','WAITING') ORDER BY sequence LIMIT 1`,[jobId]);
  return r.rows[0]||null;
}
async function stepSuccess(stepId:string,output:unknown,evidenceRefs:string[]=[]){
  await pool.query(`UPDATE job_steps SET status='SUCCEEDED',output=$2,evidence_refs=$3,attempt_history=attempt_history || $4::jsonb,updated_at=now() WHERE id=$1`,
    [stepId,JSON.stringify(output),JSON.stringify(evidenceRefs),JSON.stringify([{at:new Date().toISOString(),result:'SUCCEEDED'}])]);
}
async function executeStep(job:JobRow,step:any){
  if(step.step_type==='FRONT_SCAN'){
    const query=String(job.payload?.query||'');
    const data=await getCommerceOpportunities(query);
    const refs:string[]=[];
    for(const opportunity of data.opportunities.slice(0,8)){
      for(const ev of opportunity.evidence.slice(0,4)){
        const r=await pool.query(`INSERT INTO evidence(company_id,project_id,work_order_id,employee_slug,evidence_type,source_type,source_name,source_url,external_id,content_summary,raw_reference,confidence,verification_status)
          VALUES($1,$2,$3,$4,'SOCIAL_SIGNAL','FRONT','Front-Commerce',$5,$6,$7,$8,$9,'SOURCE_CAPTURED') RETURNING id`,
          [job.company_id,job.project_id,job.work_order_id,job.employee_slug,ev.url,ev.id,ev.excerpt,JSON.stringify({opportunity:opportunity.title,platform:ev.platform,author:ev.author,views:ev.views,likes:ev.likes}),opportunity.confidence]);
        refs.push(r.rows[0].id);
      }
    }
    return {output:{opportunities:data.opportunities,diagnostics:data.diagnostics},evidenceRefs:refs};
  }
  if(step.step_type==='MANAGER_REVIEW'){
    return {output:{status:'WAITING_MODEL_RUNTIME',note:'Manager reasoning adapter is not configured yet; no fake decision was made.'},evidenceRefs:[]};
  }
  return {output:{status:'BLOCKED_ADAPTER',stepType:step.step_type},evidenceRefs:[]};
}

export async function runOne(){
  const job=await claimJob(); if(!job)return {processed:false};
  try{
    await pool.query(`UPDATE jobs SET status='RUNNING',updated_at=now() WHERE id=$1`,[job.id]);
    const step=await nextStep(job.id);
    if(!step){
      await pool.query(`UPDATE jobs SET status='SUCCEEDED',lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id]);
      await pool.query(`UPDATE work_orders SET status='DONE',updated_at=now() WHERE id=$1`,[job.work_order_id]);
      await emitEvent(job.company_id,'JOB_SUCCEEDED',{jobId:job.id});
      return {processed:true,jobId:job.id,status:'SUCCEEDED'};
    }
    await pool.query(`UPDATE job_steps SET status='RUNNING',attempt_history=attempt_history || $2::jsonb,updated_at=now() WHERE id=$1`,
      [step.id,JSON.stringify([{at:new Date().toISOString(),result:'RUNNING'}])]);
    const result=await executeStep(job,step);
    await stepSuccess(step.id,result.output,result.evidenceRefs);
    const remaining=await nextStep(job.id);
    if(remaining && String((result.output as any)?.status||'').startsWith('BLOCKED')){
      await pool.query(`UPDATE jobs SET status='BLOCKED',last_error=$2,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id,(result.output as any).status]);
      await pool.query(`UPDATE work_orders SET status='BLOCKED',blockers=$2,updated_at=now() WHERE id=$1`,[job.work_order_id,JSON.stringify([(result.output as any).status])]);
      return {processed:true,jobId:job.id,status:'BLOCKED'};
    }
    await pool.query(`UPDATE jobs SET status='QUEUED',scheduled_for=now(),lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id]);
    await emitEvent(job.company_id,'JOB_STEP_SUCCEEDED',{jobId:job.id,stepId:step.id,stepType:step.step_type});
    return {processed:true,jobId:job.id,status:'STEP_SUCCEEDED'};
  }catch(e){
    const message=e instanceof Error?e.message:'Unknown worker error';
    const terminal=job.attempt_count>=job.max_attempts || !retryable(message);
    await pool.query(`UPDATE jobs SET status=$2,last_error=$3,scheduled_for=CASE WHEN $2='RETRY_SCHEDULED' THEN now()+interval '2 minutes' ELSE scheduled_for END,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
      [job.id,terminal?'FAILED':'RETRY_SCHEDULED',message]);
    await emitEvent(job.company_id,terminal?'JOB_FAILED':'JOB_RETRY_SCHEDULED',{jobId:job.id,error:message});
    return {processed:true,jobId:job.id,status:terminal?'FAILED':'RETRY_SCHEDULED',error:message};
  }
}
