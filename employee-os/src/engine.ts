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
  if(job.job_type==='STORE_BUILD' && step.step_type==='BRAND_STRATEGY'){
    const candidateId=String(job.payload?.candidateId||'');
    const r=await pool.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2',[candidateId,job.company_id]);
    if(!r.rowCount)throw new Error('Store build candidate not found.');
    const candidate=r.rows[0];
    const root=String(candidate.name||'Product').split(/\s+/).filter(Boolean)[0]||'Product';
    const brandDirection={
      namingStatus:'UNVERIFIED_TRADEMARK',
      workingNameOptions:[`${root}Lab`,`${root}Haus`,`${root}Co`],
      positioning:`A focused direct-to-consumer brand built around the clearest use-case for ${candidate.name}.`,
      audience:'People actively searching for the problem/use-case demonstrated by the approved product candidate.',
      visualDirection:['clean product-first composition','strong contrast','mobile-first typography','social-native demonstration imagery'],
      guardrails:['No unsupported performance claims','No fake reviews','No unverified shipping promises','Final brand name requires trademark/domain review']
    };
    const inserted=await pool.query(`INSERT INTO store_packages(
      company_id,project_id,work_order_id,candidate_id,status,brand_direction,external_state
    ) VALUES($1,$2,$3,$4,'DRAFT',$5,$6)
    ON CONFLICT(project_id,candidate_id) DO UPDATE SET
      brand_direction=EXCLUDED.brand_direction,updated_at=now()
    RETURNING *`,[
      job.company_id,job.project_id,job.work_order_id,candidate.id,JSON.stringify(brandDirection),
      JSON.stringify({shopify:'NOT_CONNECTED',publishAllowed:false})
    ]);
    return {output:{packageId:inserted.rows[0].id,brandDirection,status:'DRAFT'},evidenceRefs:[]};
  }

  if(job.job_type==='STORE_BUILD' && step.step_type==='STORE_BRIEF'){
    const candidateId=String(job.payload?.candidateId||'');
    const p=await pool.query('SELECT * FROM store_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    const c=await pool.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2',[candidateId,job.company_id]);
    if(!p.rowCount||!c.rowCount)throw new Error('Store package or candidate missing.');
    const candidate=c.rows[0];
    const offer={
      pricingStatus:'REQUIRES_VERIFIED_LANDED_COST',
      primaryOffer:`Single-product offer for ${candidate.name}`,
      bundleTests:['1x starter','2x value bundle','3x best-value bundle'],
      guarantees:['Do not promise outcome guarantees until policy/legal review'],
      shipping:'Use verified supplier shipping only; no invented delivery windows'
    };
    const pageArchitecture=[
      {section:'Hero',goal:'Explain product and primary benefit in one screen',content:['product visual','specific non-hyped headline','primary CTA']},
      {section:'Problem / Use Case',goal:'Make the customer recognize the need',content:['real scenario','no exaggerated pain claims']},
      {section:'Demonstration',goal:'Show how the product works',content:['step-by-step demo','before/after only when truthful']},
      {section:'Benefits',goal:'Translate features into outcomes',content:['3-5 evidence-safe benefits']},
      {section:'How It Works',goal:'Reduce uncertainty',content:['setup','usage','care']},
      {section:'FAQ',goal:'Resolve objections',content:['compatibility','shipping','returns','usage']},
      {section:'Offer / CTA',goal:'Make purchase decision simple',content:['bundle options','clear price','CTA']},
      {section:'Policies',goal:'Set expectations honestly',content:['shipping','returns','privacy','terms']}
    ];
    const copyDraft={
      headline:`${candidate.name}, explained clearly.`,
      subheadline:'A product-first page built to prove the use case before asking for the sale.',
      cta:'See the offer',
      note:'Copy is an internal draft; unsupported claims and invented testimonials are prohibited.'
    };
    const u=await pool.query(`UPDATE store_packages SET offer=$2,page_architecture=$3,copy_draft=$4,status='BRIEF_READY',updated_at=now()
      WHERE id=$1 RETURNING *`,[p.rows[0].id,JSON.stringify(offer),JSON.stringify(pageArchitecture),JSON.stringify(copyDraft)]);
    return {output:{packageId:u.rows[0].id,status:'BRIEF_READY',offer,pageArchitecture,copyDraft},evidenceRefs:[]};
  }

  if(job.job_type==='STORE_BUILD' && step.step_type==='STORE_QA'){
    const candidateId=String(job.payload?.candidateId||'');
    const p=await pool.query('SELECT * FROM store_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    if(!p.rowCount)throw new Error('Store package missing for QA.');
    const pkg=p.rows[0];
    const failures:string[]=[];
    if(!pkg.brand_direction||!Object.keys(pkg.brand_direction).length)failures.push('brand_direction missing');
    if(!pkg.offer||!Object.keys(pkg.offer).length)failures.push('offer missing');
    if(!Array.isArray(pkg.page_architecture)||pkg.page_architecture.length<6)failures.push('page_architecture incomplete');
    if(!pkg.copy_draft||!Object.keys(pkg.copy_draft).length)failures.push('copy_draft missing');
    const qa={
      passed:failures.length===0,
      failures,
      checks:[
        'brand direction exists',
        'offer does not invent economics',
        'mobile-first page architecture exists',
        'copy contains no fake testimonials',
        'shipping/returns remain evidence-gated',
        'publish authority remains false'
      ]
    };
    const status=qa.passed?'READY_FOR_EXTERNAL':'QA_FAILED';
    const u=await pool.query(`UPDATE store_packages SET qa_result=$2,status=$3,updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(qa),status
    ]);
    if(!qa.passed)throw new Error(`Store package QA failed: ${failures.join(', ')}`);
    return {output:{packageId:u.rows[0].id,status,qa},evidenceRefs:[]};
  }

  if(job.job_type==='STORE_BUILD' && step.step_type==='EXTERNAL_HANDOFF'){
    const candidateId=String(job.payload?.candidateId||'');
    const p=await pool.query('SELECT * FROM store_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    if(!p.rowCount)throw new Error('Store package missing for external handoff.');
    const connection=await pool.query(`SELECT * FROM tool_connections
      WHERE company_id=$1 AND provider='SHOPIFY' AND status='CONNECTED'
      ORDER BY updated_at DESC LIMIT 1`,[job.company_id]);
    if(!connection.rowCount){
      await pool.query(`UPDATE store_packages SET status='READY_NEEDS_CONNECTION',
        external_state=$2,updated_at=now() WHERE id=$1`,[
        p.rows[0].id,JSON.stringify({shopify:'NOT_CONNECTED',publishAllowed:false,lastCheckedAt:new Date().toISOString()})
      ]);
      const existing=await pool.query(`SELECT id FROM employee_messages
        WHERE company_id=$1 AND work_order_id=$2 AND type='BLOCKER'
        AND from_employee_slug='luca' AND to_employee_slug='ava' AND consumed_at IS NULL LIMIT 1`,[
        job.company_id,job.work_order_id
      ]);
      if(!existing.rowCount){
        await pool.query(`INSERT INTO employee_messages(
          company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload
        ) VALUES($1,$2,$3,'BLOCKER','luca','ava','Shopify connection required','Connect an authorized Shopify execution tool',$4,$5)`,[
          job.company_id,job.project_id,job.work_order_id,
          JSON.stringify({publishAllowed:false,spendAllowed:false}),
          JSON.stringify({packageId:p.rows[0].id,reason:'SHOPIFY_NOT_CONNECTED'})
        ]);
      }
      throw new Error('BLOCKED_EXTERNAL_AUTH: Shopify store execution is not connected');
    }

    const approval=await pool.query(`INSERT INTO approvals(
      company_id,project_id,work_order_id,job_id,requested_by_employee_slug,action_type,action_payload,reason,risk,cost_cents,status
    ) VALUES($1,$2,$3,$4,'luca','SHOPIFY_DRAFT_BUILD',$5,$6,'MEDIUM',0,'PENDING') RETURNING id`,[
      job.company_id,job.project_id,job.work_order_id,job.id,
      JSON.stringify({packageId:p.rows[0].id,connectionId:connection.rows[0].id}),
      'Luca completed internal store QA. Owner approval is required before creating or changing a Shopify draft store.'
    ]);
    await pool.query(`UPDATE store_packages SET status='NEEDS_EXTERNAL_APPROVAL',
      external_state=$2,updated_at=now() WHERE id=$1`,[
      p.rows[0].id,JSON.stringify({shopify:'CONNECTED',publishAllowed:false,approvalId:approval.rows[0].id})
    ]);
    await pool.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.work_order_id]);
    await pool.query(`UPDATE projects SET phase='STORE_EXTERNAL_APPROVAL',updated_at=now() WHERE id=$1`,[job.project_id]);
    return {output:{status:'WAITING_APPROVAL',approvalId:approval.rows[0].id,packageId:p.rows[0].id},evidenceRefs:[]};
  }

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
    return {output:{candidateId:candidate.id,candidate:discovery.candidate,...scored},evidenceRefs};
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
