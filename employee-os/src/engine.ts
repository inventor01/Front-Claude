import { pool,tx } from './db.js';
import { getCommerceOpportunities } from './front.js';
import {
  discoverCandidate,validateDemand,validateSupplier,computeEconomics,
  evaluateContentability,reviewRisk,scoreCandidate,type SourceEvidence,type DiscoveryResult,
  type DemandResult,type SupplierResult
} from './research.js';

type JobRow={id:string;company_id:string;project_id:string;work_order_id:string;employee_slug:string;job_type:string;payload:any;status:string;attempt_count:number;max_attempts:number;lease_id:string|null};
const retryable=(m:string)=>/timeout|rate|temporar|connection|502|503|504/i.test(m);

export async function emitEvent(companyId:string,type:string,payload:unknown){
  await pool.query('INSERT INTO events(company_id,type,payload) VALUES($1,$2,$3)',[companyId,type,JSON.stringify(payload)]);
}

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

async function outputFor<T>(jobId:string,stepType:string):Promise<T|null>{
  const r=await pool.query(`SELECT output FROM job_steps WHERE job_id=$1 AND step_type=$2 AND status='SUCCEEDED' ORDER BY sequence LIMIT 1`,[jobId,stepType]);
  return r.rowCount?(r.rows[0].output as T):null;
}

async function stepSuccess(stepId:string,output:unknown,evidenceRefs:string[]=[]){
  await pool.query(`UPDATE job_steps SET status='SUCCEEDED',output=$2,evidence_refs=$3,
    attempt_history=attempt_history || $4::jsonb,last_error=NULL,updated_at=now() WHERE id=$1`,
    [stepId,JSON.stringify(output),JSON.stringify(evidenceRefs),JSON.stringify([{at:new Date().toISOString(),result:'SUCCEEDED'}])]);
}

async function recordEvidence(job:JobRow,items:SourceEvidence[],evidenceType:string){
  const refs:string[]=[];
  for(const item of items){
    const r=await pool.query(`INSERT INTO evidence(
      company_id,project_id,work_order_id,employee_slug,evidence_type,source_type,source_name,source_url,
      content_summary,raw_reference,confidence,verification_status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SOURCE_CAPTURED') RETURNING id`,[
      job.company_id,job.project_id,job.work_order_id,job.employee_slug,evidenceType,item.sourceType,
      item.sourceName,item.sourceUrl,item.summary,JSON.stringify({excerpt:item.rawExcerpt}),item.confidence
    ]);
    refs.push(r.rows[0].id);
  }
  return refs;
}

async function candidateName(job:JobRow){
  const discovery=await outputFor<DiscoveryResult>(job.id,'DISCOVERY');
  return discovery?.candidate||String(job.payload?.query||'').trim();
}

async function executeStep(job:JobRow,step:any){
  if(step.step_type==='DISCOVERY'){
    const result=await discoverCandidate(String(job.payload?.query||''));
    const evidenceRefs=await recordEvidence(job,result.evidence,'DISCOVERY');
    return {output:result,evidenceRefs};
  }

  if(step.step_type==='FRONT_SCAN'){
    const candidate=await candidateName(job);
    try{
      const data=await getCommerceOpportunities(candidate);
      const items:SourceEvidence[]=[];
      for(const opportunity of data.opportunities.slice(0,5)){
        for(const ev of opportunity.evidence.slice(0,3)){
          items.push({
            sourceType:'FRONT',sourceName:'Front-Commerce',sourceUrl:ev.url,
            summary:`${opportunity.title} — ${opportunity.status}; purchase-intent mentions: ${opportunity.purchaseIntentMentions}`,
            rawExcerpt:ev.excerpt,confidence:opportunity.confidence
          });
        }
      }
      const evidenceRefs=await recordEvidence(job,items,'SOCIAL_SIGNAL');
      return {output:{status:'OK',candidate,opportunities:data.opportunities,diagnostics:data.diagnostics},evidenceRefs};
    }catch(e){
      const message=e instanceof Error?e.message:'Front-Commerce unavailable';
      if(message.startsWith('BLOCKED_EXTERNAL_AUTH:')){
        return {output:{status:'DEGRADED_SOURCE',candidate,source:'Front-Commerce',reason:message},evidenceRefs:[]};
      }
      throw e;
    }
  }

  if(step.step_type==='DEMAND_VALIDATION'){
    const discovery=await outputFor<DiscoveryResult>(job.id,'DISCOVERY');
    if(!discovery)throw new Error('Missing discovery output.');
    const result=await validateDemand(discovery.candidate,discovery);
    const evidenceRefs=await recordEvidence(job,result.evidence,'DEMAND');
    return {output:result,evidenceRefs};
  }

  if(step.step_type==='SUPPLIER_VALIDATION'){
    const candidate=await candidateName(job);
    const result=await validateSupplier(candidate);
    const evidenceRefs=await recordEvidence(job,result.evidence,'SUPPLIER');
    return {output:result,evidenceRefs};
  }

  if(step.step_type==='ECONOMICS'){
    const demand=await outputFor<DemandResult>(job.id,'DEMAND_VALIDATION');
    const supplier=await outputFor<SupplierResult>(job.id,'SUPPLIER_VALIDATION');
    if(!demand||!supplier)throw new Error('Missing demand or supplier output.');
    return {output:computeEconomics(demand,supplier),evidenceRefs:[]};
  }

  if(step.step_type==='CONTENTABILITY'){
    const candidate=await candidateName(job);
    return {output:evaluateContentability(candidate),evidenceRefs:[]};
  }

  if(step.step_type==='RISK_REVIEW'){
    const candidate=await candidateName(job);
    return {output:reviewRisk(candidate),evidenceRefs:[]};
  }

  if(step.step_type==='MANAGER_REVIEW'){
    const discovery=await outputFor<DiscoveryResult>(job.id,'DISCOVERY');
    const demand=await outputFor<DemandResult>(job.id,'DEMAND_VALIDATION');
    const supplier=await outputFor<SupplierResult>(job.id,'SUPPLIER_VALIDATION');
    const economics=await outputFor<ReturnType<typeof computeEconomics>>(job.id,'ECONOMICS');
    const content=await outputFor<ReturnType<typeof evaluateContentability>>(job.id,'CONTENTABILITY');
    const risk=await outputFor<ReturnType<typeof reviewRisk>>(job.id,'RISK_REVIEW');
    if(!discovery||!demand||!supplier||!economics||!content||!risk)throw new Error('Manager review is missing required step outputs.');
    const scored=scoreCandidate({demand,supplier,economics,content,risk});

    const inserted=await pool.query(`INSERT INTO product_candidates(
      company_id,project_id,work_order_id,name,status,score,confidence,discovery_mode,trend_growth_pct,demand_score,
      marketplace_seen,supplier_seen,observed_market_price,observed_source_price,observed_gross_margin_pct,
      contentability_score,risk_flags,creative_angles,analysis
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT(project_id,name) DO UPDATE SET
      status=EXCLUDED.status,score=EXCLUDED.score,confidence=EXCLUDED.confidence,demand_score=EXCLUDED.demand_score,
      marketplace_seen=EXCLUDED.marketplace_seen,supplier_seen=EXCLUDED.supplier_seen,
      observed_market_price=EXCLUDED.observed_market_price,observed_source_price=EXCLUDED.observed_source_price,
      observed_gross_margin_pct=EXCLUDED.observed_gross_margin_pct,contentability_score=EXCLUDED.contentability_score,
      risk_flags=EXCLUDED.risk_flags,creative_angles=EXCLUDED.creative_angles,analysis=EXCLUDED.analysis,updated_at=now()
    RETURNING *`,[
      job.company_id,job.project_id,job.work_order_id,discovery.candidate,scored.status,scored.score,scored.confidence,
      discovery.discoveryMode,discovery.trendGrowthPct,demand.demandScore,demand.marketplaceSeen,supplier.supplierSeen,
      economics.observedMarketPrice,economics.observedSourcePrice,economics.observedGrossMarginPct,
      content.contentabilityScore,JSON.stringify(risk.flags),JSON.stringify(content.angles),
      JSON.stringify({discovery,demand,supplier,economics,content,risk,scored})
    ]);
    const candidate=inserted.rows[0];

    const refsR=await pool.query(`SELECT evidence_refs FROM job_steps WHERE job_id=$1 ORDER BY sequence`,[job.id]);
    const evidenceRefs=[...new Set(refsR.rows.flatMap((r:any)=>Array.isArray(r.evidence_refs)?r.evidence_refs:[]))];

    await pool.query(`INSERT INTO employee_messages(
      company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,evidence_refs,authority_context,payload
    ) VALUES($1,$2,$3,'WORK_RESULT','rowan','ava',$4,'Review candidate and product gate',$5,$6,$7)`,[
      job.company_id,job.project_id,job.work_order_id,`Evaluate ${discovery.candidate} for launch`,
      JSON.stringify(evidenceRefs),JSON.stringify({launchAuthority:false,spendAllowed:false,publishAllowed:false}),
      JSON.stringify({candidateId:candidate.id,status:scored.status,score:scored.score,confidence:scored.confidence})
    ]);

    if(scored.status==='LAUNCH_REVIEW'){
      const approval=await pool.query(`INSERT INTO approvals(
        company_id,project_id,work_order_id,requested_by_employee_slug,action_type,action_payload,reason,risk,cost_cents,status
      ) VALUES($1,$2,$3,'ava','PRODUCT_GATE',$4,$5,'MEDIUM',0,'PENDING') RETURNING id`,[
        job.company_id,job.project_id,job.work_order_id,
        JSON.stringify({candidateId:candidate.id,candidate:discovery.candidate,score:scored.score,confidence:scored.confidence}),
        `Evidence-backed candidate reached LAUNCH_REVIEW. Score ${scored.score}/100; contentability ${content.contentabilityScore}/100; confidence ${scored.confidence}.`
      ]);
      await pool.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.work_order_id]);
      await pool.query(`UPDATE projects SET phase='PRODUCT_GATE',updated_at=now() WHERE id=$1`,[job.project_id]);
      await emitEvent(job.company_id,'PRODUCT_GATE_REQUIRED',{jobId:job.id,workOrderId:job.work_order_id,candidateId:candidate.id,approvalId:approval.rows[0].id});
    }else if(scored.status==='VERIFIED_CANDIDATE'){
      await pool.query(`UPDATE work_orders SET status='PARTIAL',blockers=$2,updated_at=now() WHERE id=$1`,[
        job.work_order_id,JSON.stringify(['Candidate verified but did not meet automatic launch-review threshold.'])
      ]);
      await pool.query(`UPDATE projects SET phase='RESEARCH_ITERATION',updated_at=now() WHERE id=$1`,[job.project_id]);
      await emitEvent(job.company_id,'PRODUCT_CANDIDATE_VERIFIED',{jobId:job.id,candidateId:candidate.id,score:scored.score});
    }else{
      await pool.query(`UPDATE work_orders SET status='PARTIAL',blockers=$2,updated_at=now() WHERE id=$1`,[
        job.work_order_id,JSON.stringify([`Candidate status: ${scored.status}; another research iteration is required.`])
      ]);
      await pool.query(`UPDATE projects SET phase='RESEARCH_ITERATION',updated_at=now() WHERE id=$1`,[job.project_id]);
      await emitEvent(job.company_id,'PRODUCT_CANDIDATE_NOT_READY',{jobId:job.id,candidateId:candidate.id,status:scored.status,score:scored.score});
    }
    return {output:{status:scored.status,candidateId:candidate.id,candidate:discovery.candidate,...scored},evidenceRefs};
  }

  return {output:{status:'BLOCKED_ADAPTER',stepType:step.step_type},evidenceRefs:[]};
}

export async function runOne(){
  const job=await claimJob(); if(!job)return {processed:false};
  try{
    await pool.query(`UPDATE jobs SET status='RUNNING',updated_at=now() WHERE id=$1`,[job.id]);
    await pool.query(`UPDATE work_orders SET status='IN_PROGRESS',updated_at=now() WHERE id=$1 AND status='READY'`,[job.work_order_id]);
    const step=await nextStep(job.id);
    if(!step){
      await pool.query(`UPDATE jobs SET status='SUCCEEDED',lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id]);
      await pool.query(`UPDATE work_orders SET status='DONE',updated_at=now() WHERE id=$1 AND status IN ('READY','IN_PROGRESS')`,[job.work_order_id]);
      await emitEvent(job.company_id,'JOB_SUCCEEDED',{jobId:job.id,workOrderId:job.work_order_id});
      return {processed:true,jobId:job.id,status:'SUCCEEDED'};
    }

    await pool.query(`UPDATE job_steps SET status='RUNNING',attempt_history=attempt_history || $2::jsonb,updated_at=now() WHERE id=$1`,
      [step.id,JSON.stringify([{at:new Date().toISOString(),result:'RUNNING'}])]);

    const result=await executeStep(job,step);
    await stepSuccess(step.id,result.output,result.evidenceRefs);

    if(String((result.output as any)?.status||'').startsWith('BLOCKED') || String((result.output as any)?.status||'').startsWith('WAITING_')){
      await pool.query(`UPDATE jobs SET status='BLOCKED',last_error=$2,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id,(result.output as any).status]);
      await pool.query(`UPDATE work_orders SET status='BLOCKED',blockers=$2,updated_at=now() WHERE id=$1`,[job.work_order_id,JSON.stringify([(result.output as any).status])]);
      await emitEvent(job.company_id,'JOB_BLOCKED',{jobId:job.id,workOrderId:job.work_order_id,reason:(result.output as any).status});
      return {processed:true,jobId:job.id,status:'BLOCKED'};
    }

    await pool.query(`UPDATE jobs SET status='QUEUED',scheduled_for=now(),lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id]);
    await emitEvent(job.company_id,'JOB_STEP_SUCCEEDED',{jobId:job.id,stepId:step.id,stepType:step.step_type});
    return {processed:true,jobId:job.id,status:'STEP_SUCCEEDED'};
  }catch(e){
    const message=e instanceof Error?e.message:'Unknown worker error';
    const blockedExternalAuth=message.startsWith('BLOCKED_EXTERNAL_AUTH:');
    const terminal=blockedExternalAuth || job.attempt_count>=job.max_attempts || !retryable(message);
    const jobStatus=blockedExternalAuth ? 'BLOCKED' : terminal ? 'FAILED' : 'RETRY_SCHEDULED';
    const stepStatus=blockedExternalAuth ? 'BLOCKED' : terminal ? 'FAILED' : 'WAITING';

    await pool.query(`UPDATE job_steps
      SET status=$2,last_error=$3,attempt_history=attempt_history || $4::jsonb,updated_at=now()
      WHERE job_id=$1 AND status='RUNNING'`,
      [job.id,stepStatus,message,JSON.stringify([{at:new Date().toISOString(),result:jobStatus,error:message}])]);

    await pool.query(`UPDATE jobs SET status=$2,last_error=$3,
      scheduled_for=CASE WHEN $2='RETRY_SCHEDULED' THEN now()+interval '2 minutes' ELSE scheduled_for END,
      lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
      [job.id,jobStatus,message]);

    if(terminal){
      const workStatus=blockedExternalAuth ? 'BLOCKED_EXTERNAL_AUTH' : 'FAILED';
      await pool.query(`UPDATE work_orders SET status=$2,blockers=$3,updated_at=now() WHERE id=$1`,
        [job.work_order_id,workStatus,JSON.stringify([message])]);
    }else{
      await pool.query(`UPDATE work_orders SET status='IN_PROGRESS',blockers=$2,updated_at=now() WHERE id=$1`,
        [job.work_order_id,JSON.stringify([message])]);
    }

    const eventType=blockedExternalAuth ? 'JOB_BLOCKED' : terminal ? 'JOB_FAILED' : 'JOB_RETRY_SCHEDULED';
    await emitEvent(job.company_id,eventType,{jobId:job.id,workOrderId:job.work_order_id,error:message});
    return {processed:true,jobId:job.id,status:jobStatus,error:message};
  }
}
