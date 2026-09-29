import { pool,tx } from './db.js';
import { getCommerceOpportunities } from './front.js';
import {
  discoverCandidate,validateDemand,validateSupplier,computeEconomics,
  evaluateContentability,reviewRisk,scoreCandidate,type SourceEvidence,type DiscoveryResult,
  type DemandResult,type SupplierResult
} from './research.js';
import { getEmployeeIntelligenceContext,type EmployeeIntelligenceContext } from './academy.js';

type JsonRecord=Record<string,unknown>;
type JobRow={id:string;company_id:string;project_id:string;work_order_id:string;employee_slug:string;job_type:string;payload:JsonRecord;status:string;attempt_count:number;retry_count:number;max_attempts:number;lease_id:string|null};
type StepRow={id:string;step_type:string};
type CreativeScene={action?:unknown;onScreenText?:unknown};
type CreativeScript={id?:unknown;hook?:unknown;cta?:unknown;scenes?:CreativeScene[];renderedAssetId?:unknown};
type DistributionCalendarItem={platform?:unknown;status?:unknown};
function resultStatus(output:unknown){
  if(typeof output!=='object'||output===null||!('status' in output))return '';
  return String((output as {status?:unknown}).status||'');
}
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

async function executeStep(job:JobRow,step:StepRow,intelligence:EmployeeIntelligenceContext){
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

    const existingResult=await pool.query(`SELECT id FROM employee_messages
      WHERE company_id=$1 AND project_id=$2 AND work_order_id=$3 AND type='WORK_RESULT'
      AND from_employee_slug='luca' AND to_employee_slug='ava'
      AND payload->>'storePackageId'=$4 LIMIT 1`,[
      job.company_id,job.project_id,job.work_order_id,String(u.rows[0].id)
    ]);
    if(!existingResult.rowCount){
      await pool.query(`INSERT INTO employee_messages(
        company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
        evidence_refs,authority_context,payload
      ) VALUES($1,$2,$3,'WORK_RESULT','luca','ava',$4,'Review store QA and start creative production',$5,$6,$7)`,[
        job.company_id,job.project_id,job.work_order_id,
        `Internal store package for ${candidateId} passed QA`,
        JSON.stringify([]),JSON.stringify({publishAllowed:false,spendAllowed:false,storeQaPassed:true}),
        JSON.stringify({storePackageId:u.rows[0].id,candidateId,status})
      ]);
    }
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
      await pool.query(`UPDATE projects SET phase='STORE_CONNECTION_REQUIRED',updated_at=now() WHERE id=$1`,[job.project_id]);
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

  if(job.job_type==='SUPPORT_CASE' && step.step_type==='SUPPORT_CLASSIFY'){
    const caseId=String(job.payload?.supportCaseId||'');
    const r=await pool.query('SELECT * FROM support_cases WHERE id=$1 AND company_id=$2',[caseId,job.company_id]);
    if(!r.rowCount)throw new Error('Support case not found.');
    const supportCase=r.rows[0];
    const text=`${supportCase.subject} ${supportCase.customer_message}`.toLowerCase();
    let category='GENERAL_QUESTION';
    if(/refund|return|money back/.test(text))category='REFUND_RETURN';
    else if(/where.*order|tracking|arriv|delivery|shipping/.test(text))category='ORDER_SHIPPING';
    else if(/broken|damaged|defect|doesn.t work|not working/.test(text))category='PRODUCT_ISSUE';
    else if(/fit|compatible|work with|size|use on/.test(text))category='COMPATIBILITY';
    else if(/cancel/.test(text))category='CANCELLATION';
    const severity=/chargeback|lawyer|legal|fraud|injur|unsafe|bank dispute/.test(text)?'HIGH':/refund|damaged|not working/.test(text)?'MEDIUM':'LOW';
    await pool.query(`UPDATE support_cases SET category=$2,severity=$3,status='CLASSIFIED',updated_at=now() WHERE id=$1`,[
      caseId,category,severity
    ]);
    return {output:{caseId,category,severity,status:'CLASSIFIED'},evidenceRefs:[]};
  }

  if(job.job_type==='SUPPORT_CASE' && step.step_type==='SUPPORT_DRAFT'){
    const caseId=String(job.payload?.supportCaseId||'');
    const r=await pool.query('SELECT * FROM support_cases WHERE id=$1 AND company_id=$2',[caseId,job.company_id]);
    if(!r.rowCount)throw new Error('Support case not found for drafting.');
    const sc=r.rows[0];
    const responses:Record<string,string>={
      ORDER_SHIPPING:'Thanks for reaching out. I can help check the order status. Please share the order number or the email used at checkout. I will only give a delivery estimate once it is verified from the order or carrier record.',
      REFUND_RETURN:'Thanks for reaching out. I can help with the return or refund request. Please share the order number and the reason for the request so I can apply the store policy accurately. I will not promise a refund amount until the order and policy are verified.',
      PRODUCT_ISSUE:'Thanks for letting us know. I want to get this resolved. Please send the order number and a short description or photo of the issue if available. I will check the product/order details before recommending the next step.',
      COMPATIBILITY:'Thanks for the question. I can check compatibility for you. Please tell me the exact model, surface, size, or setup you plan to use it with. I will avoid guessing when the product specifications do not verify compatibility.',
      CANCELLATION:'I can help check whether the order can still be cancelled. Please share the order number. I will confirm its fulfillment state before promising a cancellation.',
      GENERAL_QUESTION:'Thanks for reaching out. I can help. Please share any order number or product detail that applies, and I will answer from the verified store and order information rather than guess.'
    };
    const draft=responses[String(sc.category)]||responses.GENERAL_QUESTION;
    await pool.query(`UPDATE support_cases SET draft_response=$2,status='DRAFT_READY',updated_at=now() WHERE id=$1`,[caseId,draft]);
    return {output:{caseId,status:'DRAFT_READY',draftResponse:draft},evidenceRefs:[]};
  }

  if(job.job_type==='SUPPORT_CASE' && step.step_type==='SUPPORT_FEEDBACK'){
    const caseId=String(job.payload?.supportCaseId||'');
    const r=await pool.query('SELECT * FROM support_cases WHERE id=$1 AND company_id=$2',[caseId,job.company_id]);
    if(!r.rowCount)throw new Error('Support case not found for feedback.');
    const sc=r.rows[0];
    const category=String(sc.category||'GENERAL_QUESTION');
    const patternKey=category.toLowerCase();
    const pattern=await pool.query(`INSERT INTO issue_patterns(company_id,pattern_key,category,latest_example)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(company_id,pattern_key) DO UPDATE SET
        occurrences=issue_patterns.occurrences+1,
        latest_example=EXCLUDED.latest_example,
        last_seen_at=now()
      RETURNING *`,[
      job.company_id,patternKey,category,String(sc.customer_message).slice(0,500)
    ]);
    const p=pattern.rows[0];
    if(Number(p.occurrences)>=2){
      for(const to of ['luca','maya']){
        const existing=await pool.query(`SELECT id FROM employee_messages WHERE company_id=$1 AND type='INFO_REQUEST'
          AND from_employee_slug='ellis' AND to_employee_slug=$2
          AND payload->>'patternId'=$3 AND consumed_at IS NULL LIMIT 1`,[job.company_id,to,String(p.id)]);
        if(!existing.rowCount){
          await pool.query(`INSERT INTO employee_messages(
            company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
            authority_context,payload
          ) VALUES($1,$2,$3,'INFO_REQUEST','ellis',$4,$5,$6,$7,$8)`,[
            job.company_id,job.project_id,job.work_order_id,to,
            `Recurring customer issue: ${category}`,
            to==='luca'?'Review store page/FAQ for a clearer answer':'Consider a truthful content piece that answers this repeated question',
            JSON.stringify({publishAllowed:false,spendAllowed:false}),
            JSON.stringify({patternId:p.id,category,occurrences:p.occurrences,latestExample:p.latest_example})
          ]);
        }
      }
      await emitEvent(job.company_id,'CUSTOMER_ISSUE_PATTERN_DETECTED',{patternId:p.id,category,occurrences:p.occurrences});
    }
    return {output:{caseId,patternId:p.id,category,occurrences:p.occurrences,status:'FEEDBACK_RECORDED'},evidenceRefs:[]};
  }

  if(job.job_type==='SUPPORT_CASE' && step.step_type==='SUPPORT_SEND_HANDOFF'){
    const caseId=String(job.payload?.supportCaseId||'');
    const r=await pool.query('SELECT * FROM support_cases WHERE id=$1 AND company_id=$2',[caseId,job.company_id]);
    if(!r.rowCount)throw new Error('Support case missing for send handoff.');
    const sc=r.rows[0];
    const provider=String(sc.channel).toUpperCase()==='LIVE_CHAT'?'LIVE_CHAT':'EMAIL';
    const connection=await pool.query(`SELECT * FROM tool_connections
      WHERE company_id=$1 AND provider=$2 AND status='CONNECTED'
      ORDER BY updated_at DESC LIMIT 1`,[job.company_id,provider]);
    if(!connection.rowCount){
      await pool.query(`UPDATE support_cases SET status='READY_NEEDS_SUPPORT_CONNECTION',
        external_state=$2,updated_at=now() WHERE id=$1`,[
        caseId,JSON.stringify({provider,status:'NOT_CONNECTED',sent:false,lastCheckedAt:new Date().toISOString()})
      ]);
      const existing=await pool.query(`SELECT id FROM employee_messages WHERE company_id=$1 AND work_order_id=$2
        AND type='BLOCKER' AND from_employee_slug='ellis' AND to_employee_slug='ava'
        AND payload->>'reason'='SUPPORT_PROVIDER_NOT_CONNECTED' AND consumed_at IS NULL LIMIT 1`,[
        job.company_id,job.work_order_id
      ]);
      if(!existing.rowCount){
        await pool.query(`INSERT INTO employee_messages(
          company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload
        ) VALUES($1,$2,$3,'BLOCKER','ellis','ava','Customer reply provider connection required','Connect an authorized customer support provider',$4,$5)`,[
          job.company_id,job.project_id,job.work_order_id,JSON.stringify({customerContactAllowed:false,spendAllowed:false}),
          JSON.stringify({supportCaseId:caseId,reason:'SUPPORT_PROVIDER_NOT_CONNECTED',provider})
        ]);
      }
      throw new Error(`BLOCKED_EXTERNAL_AUTH: ${provider} support provider is not connected`);
    }
    const approval=await pool.query(`INSERT INTO approvals(
      company_id,project_id,work_order_id,job_id,requested_by_employee_slug,action_type,action_payload,reason,risk,cost_cents,status
    ) VALUES($1,$2,$3,$4,'ellis','SUPPORT_SEND',$5,$6,'MEDIUM',0,'PENDING') RETURNING id`,[
      job.company_id,job.project_id,job.work_order_id,job.id,
      JSON.stringify({supportCaseId:caseId,connectionId:connection.rows[0].id,provider}),
      'Ellis prepared a customer reply. Owner approval is required before the MVP sends an external customer message.'
    ]);
    await pool.query(`UPDATE support_cases SET status='NEEDS_SEND_APPROVAL',
      external_state=$2,updated_at=now() WHERE id=$1`,[
      caseId,JSON.stringify({provider,status:'CONNECTED',sent:false,approvalId:approval.rows[0].id})
    ]);
    await pool.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.work_order_id]);
    return {output:{caseId,status:'WAITING_APPROVAL',approvalId:approval.rows[0].id},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='CREATIVE_STRATEGY'){
    const candidateId=String(job.payload?.candidateId||'');
    const storePackageId=String(job.payload?.storePackageId||'');
    const [candidateR,storeR]=await Promise.all([
      pool.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2',[candidateId,job.company_id]),
      pool.query('SELECT * FROM store_packages WHERE id=$1 AND company_id=$2',[storePackageId,job.company_id])
    ]);
    if(!candidateR.rowCount||!storeR.rowCount)throw new Error('Creative production inputs are missing.');
    const candidate=candidateR.rows[0], store=storeR.rows[0];
    if(store.qa_result?.passed!==true)throw new Error('Creative production requires a QA-passed store package.');
    const strategy={
      product:candidate.name,
      primaryPlatforms:['TikTok','Instagram Reels'],
      secondaryPlatforms:['YouTube Shorts'],
      contentPillars:['problem → solution demonstration','before/after where evidence-safe','POV/use-case','comparison to old method','FAQ/objection handling','reaction/unboxing','feature discovery'],
      tone:['native social','fast first-frame clarity','specific, not hypey','product-led'],
      visualRules:Array.isArray(store.brand_direction?.visualDirection)?store.brand_direction.visualDirection:[],
      claimGuardrails:['No unsupported outcome claims','No invented testimonials','No fake scarcity','No unverified shipping claims','Before/after only when truthful and reproducible'],
      objective:'Create a reusable organic creative system with enough variation for sustained TikTok and Instagram testing.',
      reasoningContract:{
        firstPrinciples:intelligence.profile.firstPrinciples,
        forwardHorizonSteps:intelligence.profile.forwardHorizonSteps,
        uncertaintyPolicy:intelligence.profile.uncertaintyPolicy,
        learningPolicy:intelligence.profile.learningPolicy
      },
      trainingContext:intelligence.lessons.slice(0,12).map((lesson)=>({
        lessonId:lesson.id,sourceId:lesson.sourceId,sourceTitle:lesson.title,sourceQuality:lesson.sourceQuality,
        lessonType:lesson.lessonType,principle:lesson.principle,confidence:lesson.confidence
      }))
    };
    const inserted=await pool.query(`INSERT INTO creative_packages(
      company_id,project_id,work_order_id,candidate_id,store_package_id,status,strategy,external_state
    ) VALUES($1,$2,$3,$4,$5,'STRATEGY_READY',$6,$7)
    ON CONFLICT(project_id,candidate_id) DO UPDATE SET
      store_package_id=EXCLUDED.store_package_id,strategy=EXCLUDED.strategy,status='STRATEGY_READY',updated_at=now()
    RETURNING *`,[
      job.company_id,job.project_id,job.work_order_id,candidateId,storePackageId,
      JSON.stringify(strategy),JSON.stringify({renderer:'NOT_CONNECTED',renderedAssets:0,publishableAssets:0})
    ]);
    return {output:{creativePackageId:inserted.rows[0].id,status:'STRATEGY_READY',strategy},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='HOOK_LIBRARY'){
    const candidateId=String(job.payload?.candidateId||'');
    const r=await pool.query('SELECT c.*,p.creative_angles FROM creative_packages c JOIN product_candidates p ON p.id=c.candidate_id WHERE c.project_id=$1 AND c.candidate_id=$2',[job.project_id,candidateId]);
    if(!r.rowCount)throw new Error('Creative package missing for hooks.');
    const pkg=r.rows[0];
    const base=Array.isArray(pkg.creative_angles)?pkg.creative_angles:[];
    const product=String((await pool.query('SELECT name FROM product_candidates WHERE id=$1',[candidateId])).rows[0]?.name||'this product');
    const hooks=[
      `I didn't expect ${product} to make this this much easier.`,
      `If you still do this the old way, watch this.`,
      `The 3-second reason people notice ${product}.`,
      `POV: you finally try ${product} after seeing it everywhere.`,
      `Before you buy ${product}, here's what it actually does.`,
      `The part of ${product} nobody shows you.`,
      `I tested ${product} so you don't have to guess.`,
      `${product} vs. the old way — side by side.`,
      `One tiny product, one very specific problem solved.`,
      `Would this actually work for your setup? Let's test it.`,
      `Three things I'd want to know before buying ${product}.`,
      `The fastest way to understand why ${product} is getting attention.`,
      ...base.map((x:unknown)=>String(x))
    ].filter((x,i,a)=>x&&a.indexOf(x)===i).slice(0,18);
    const u=await pool.query(`UPDATE creative_packages SET hooks=$2,status='HOOKS_READY',updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(hooks)
    ]);
    return {output:{creativePackageId:u.rows[0].id,status:'HOOKS_READY',hooks},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='SCRIPT_PACK'){
    const candidateId=String(job.payload?.candidateId||'');
    const r=await pool.query('SELECT c.*,p.name candidate_name FROM creative_packages c JOIN product_candidates p ON p.id=c.candidate_id WHERE c.project_id=$1 AND c.candidate_id=$2',[job.project_id,candidateId]);
    if(!r.rowCount)throw new Error('Creative package missing for scripts.');
    const pkg=r.rows[0], product=String(pkg.candidate_name), hooks=Array.isArray(pkg.hooks)?pkg.hooks:[];
    const formats=[
      ['demo','15','show the product immediately','Demonstrate the primary use case in three simple beats.','See how it fits your routine.'],
      ['problem-solution','20','open on the frustrating old method','Show the problem, introduce the product, demonstrate the change.','If this is your problem, compare the details.'],
      ['pov','15','POV first-person setup','Use the product in a believable everyday situation.','Would you use this?'],
      ['comparison','25','split-screen old way vs product','Compare process and visible differences without unsupported claims.','Pick the method that makes sense for you.'],
      ['faq','20','lead with a real purchase question','Answer compatibility, usage, care, and what the product does not promise.','Check the product details before buying.'],
      ['reaction','15','unbox and inspect before using','Show first impression, setup, one use, and honest takeaway.','See the full product details.']
    ];
    const scripts=formats.map((f,i:number)=>({
      id:`creative-${i+1}`,format:f[0],durationSec:Number(f[1]),hook:String(hooks[i]||hooks[0]||`Watch ${product} in use.`),
      hypothesis:`${f[0]} format can make the product use case understandable without relying on unsupported claims.`,
      scenes:[
        {beat:1,seconds:'0-3',action:f[2],onScreenText:String(hooks[i]||hooks[0]||product)},
        {beat:2,seconds:'3-10',action:f[3],onScreenText:`${product}: show, don't overclaim`},
        {beat:3,seconds:`10-${f[1]}`,action:'Close on the product and one evidence-safe takeaway.',onScreenText:f[4]}
      ],
      voiceover:`${String(hooks[i]||hooks[0]||product)} Show the real use case, explain only what is visible or verified, then invite the viewer to inspect the details.`,
      cta:f[4],
      renderedAssetId:null
    }));
    const u=await pool.query(`UPDATE creative_packages SET scripts=$2,status='SCRIPTS_READY',updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(scripts)
    ]);
    return {output:{creativePackageId:u.rows[0].id,status:'SCRIPTS_READY',scripts},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='STORYBOARDS'){
    const candidateId=String(job.payload?.candidateId||'');
    const r=await pool.query('SELECT * FROM creative_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    if(!r.rowCount)throw new Error('Creative package missing for storyboards.');
    const pkg=r.rows[0], scripts:CreativeScript[]=Array.isArray(pkg.scripts)?pkg.scripts:[];
    const storyboards=scripts.map((script)=>({
      scriptId:script.id,
      shots:(script.scenes||[]).map((scene,index:number)=>({
        shot:index+1,
        framing:index===0?'tight product/problem close-up':index===1?'hands-on medium demonstration':'clean product close',
        action:scene.action,
        text:scene.onScreenText,
        edit:index===0?'hard cut / motion in first frame':index===1?'fast proof-driven cuts':'hold long enough to read CTA'
      }))
    }));
    const u=await pool.query(`UPDATE creative_packages SET storyboards=$2,status='STORYBOARDS_READY',updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(storyboards)
    ]);
    return {output:{creativePackageId:u.rows[0].id,status:'STORYBOARDS_READY',storyboards},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='CREATIVE_QA'){
    const candidateId=String(job.payload?.candidateId||'');
    const r=await pool.query('SELECT * FROM creative_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    if(!r.rowCount)throw new Error('Creative package missing for QA.');
    const pkg=r.rows[0], failures:string[]=[];
    const hooks=Array.isArray(pkg.hooks)?pkg.hooks:[], scripts:CreativeScript[]=Array.isArray(pkg.scripts)?pkg.scripts:[], boards=Array.isArray(pkg.storyboards)?pkg.storyboards:[];
    if(hooks.length<10)failures.push('fewer than 10 hooks');
    if(scripts.length<6)failures.push('fewer than 6 scripts');
    if(boards.length<scripts.length)failures.push('missing storyboards');
    if(scripts.some((script)=>!script.hook||!script.cta||!Array.isArray(script.scenes)||script.scenes.length<3))failures.push('script structure incomplete');
    const serialized=JSON.stringify({hooks,scripts,boards}).toLowerCase();
    if(/guaranteed result|guaranteed to|100% guaranteed|real customer said|5-star customer/.test(serialized))failures.push('unsupported or fabricated claim detected');
    const qa={passed:failures.length===0,failures,checks:['10+ hooks','6+ structured short-form scripts','storyboard for every script','CTA on every script','no fake testimonial or guarantee language','render state remains separate from script state']};
    const status=qa.passed?'READY_FOR_RENDER':'QA_FAILED';
    const u=await pool.query(`UPDATE creative_packages SET qa_result=$2,status=$3,updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(qa),status
    ]);
    if(!qa.passed)throw new Error(`Creative package QA failed: ${failures.join(', ')}`);

    const existing=await pool.query(`SELECT id FROM employee_messages
      WHERE company_id=$1 AND project_id=$2 AND type='WORK_RESULT'
      AND from_employee_slug='maya' AND to_employee_slug='ava'
      AND payload->>'creativePackageId'=$3 LIMIT 1`,[job.company_id,job.project_id,String(u.rows[0].id)]);
    if(!existing.rowCount){
      await pool.query(`INSERT INTO employee_messages(
        company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
        evidence_refs,authority_context,payload
      ) VALUES($1,$2,$3,'WORK_RESULT','maya','ava',$4,'Start distribution planning from QA-passed creative specs',$5,$6,$7)`,[
        job.company_id,job.project_id,job.work_order_id,'Creative production package passed internal QA',
        JSON.stringify([]),JSON.stringify({publishAllowed:false,spendAllowed:false,creativeQaPassed:true}),
        JSON.stringify({creativePackageId:u.rows[0].id,candidateId,status})
      ]);
    }
    return {output:{creativePackageId:u.rows[0].id,status,qa},evidenceRefs:[]};
  }

  if(job.job_type==='CREATIVE_PRODUCTION' && step.step_type==='RENDER_HANDOFF'){
    const candidateId=String(job.payload?.candidateId||'');
    const p=await pool.query('SELECT * FROM creative_packages WHERE project_id=$1 AND candidate_id=$2',[job.project_id,candidateId]);
    if(!p.rowCount)throw new Error('Creative package missing for render handoff.');
    const connection=await pool.query(`SELECT * FROM tool_connections
      WHERE company_id=$1 AND provider IN ('RUNWAY','CREATIVE_RENDER') AND status='CONNECTED'
      ORDER BY updated_at DESC LIMIT 1`,[job.company_id]);
    if(!connection.rowCount){
      await pool.query(`UPDATE creative_packages SET status='READY_NEEDS_RENDER_CONNECTION',
        external_state=$2,updated_at=now() WHERE id=$1`,[
        p.rows[0].id,JSON.stringify({renderer:'NOT_CONNECTED',renderedAssets:0,publishableAssets:0,lastCheckedAt:new Date().toISOString()})
      ]);
      const existing=await pool.query(`SELECT id FROM employee_messages WHERE company_id=$1 AND work_order_id=$2
        AND type='BLOCKER' AND from_employee_slug='maya' AND to_employee_slug='ava'
        AND payload->>'reason'='CREATIVE_RENDER_NOT_CONNECTED' AND consumed_at IS NULL LIMIT 1`,[
        job.company_id,job.work_order_id
      ]);
      if(!existing.rowCount){
        await pool.query(`INSERT INTO employee_messages(
          company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload
        ) VALUES($1,$2,$3,'BLOCKER','maya','ava','Creative renderer connection required','Connect an approved image/video rendering tool',$4,$5)`,[
          job.company_id,job.project_id,job.work_order_id,JSON.stringify({publishAllowed:false,spendAllowed:false}),
          JSON.stringify({creativePackageId:p.rows[0].id,reason:'CREATIVE_RENDER_NOT_CONNECTED'})
        ]);
      }
      throw new Error('BLOCKED_EXTERNAL_AUTH: Creative rendering tool is not connected');
    }
    const approval=await pool.query(`INSERT INTO approvals(
      company_id,project_id,work_order_id,job_id,requested_by_employee_slug,action_type,action_payload,reason,risk,cost_cents,status
    ) VALUES($1,$2,$3,$4,'maya','CREATIVE_RENDER',$5,$6,'MEDIUM',0,'PENDING') RETURNING id`,[
      job.company_id,job.project_id,job.work_order_id,job.id,
      JSON.stringify({creativePackageId:p.rows[0].id,connectionId:connection.rows[0].id}),
      'Creative specs passed QA. Owner approval is required before external rendering because rendering may create provider cost.'
    ]);
    await pool.query(`UPDATE creative_packages SET status='NEEDS_RENDER_APPROVAL',
      external_state=$2,updated_at=now() WHERE id=$1`,[
      p.rows[0].id,JSON.stringify({renderer:'CONNECTED',renderedAssets:0,publishableAssets:0,approvalId:approval.rows[0].id})
    ]);
    await pool.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.work_order_id]);
    return {output:{status:'WAITING_APPROVAL',approvalId:approval.rows[0].id,creativePackageId:p.rows[0].id},evidenceRefs:[]};
  }

  if(job.job_type==='DISTRIBUTION_PLANNING' && step.step_type==='CHANNEL_PLAN'){
    const creativePackageId=String(job.payload?.creativePackageId||'');
    const cR=await pool.query('SELECT * FROM creative_packages WHERE id=$1 AND company_id=$2',[creativePackageId,job.company_id]);
    if(!cR.rowCount||cR.rows[0].qa_result?.passed!==true)throw new Error('Distribution requires a QA-passed creative package.');
    const plan={
      primary:['TikTok','Instagram Reels'],
      secondary:['YouTube Shorts'],
      rules:{
        TikTok:'Native 9:16, immediate hook, minimal polished-ad feel, test comments/questions as follow-ups.',
        Instagram:'9:16 Reel, cleaner cover/title treatment, preserve native pacing.',
        YouTubeShorts:'Reuse strongest verified creative after TikTok/IG signal; keep title searchable and concise.'
      },
      measurement:['views','3-second retention','average watch time','completion rate','shares','comments','profile/product clicks'],
      publishingAuthority:false
    };
    const inserted=await pool.query(`INSERT INTO distribution_packages(
      company_id,project_id,work_order_id,creative_package_id,status,channel_plan,external_state
    ) VALUES($1,$2,$3,$4,'PLAN_READY',$5,$6)
    ON CONFLICT(project_id,creative_package_id) DO UPDATE SET channel_plan=EXCLUDED.channel_plan,status='PLAN_READY',updated_at=now()
    RETURNING *`,[
      job.company_id,job.project_id,job.work_order_id,creativePackageId,JSON.stringify(plan),
      JSON.stringify({tiktok:'NOT_CONNECTED',instagram:'NOT_CONNECTED',publishedCount:0})
    ]);
    return {output:{distributionPackageId:inserted.rows[0].id,status:'PLAN_READY',plan},evidenceRefs:[]};
  }

  if(job.job_type==='DISTRIBUTION_PLANNING' && step.step_type==='CONTENT_CALENDAR'){
    const creativePackageId=String(job.payload?.creativePackageId||'');
    const r=await pool.query(`SELECT d.*,c.scripts,c.hooks FROM distribution_packages d
      JOIN creative_packages c ON c.id=d.creative_package_id
      WHERE d.project_id=$1 AND d.creative_package_id=$2`,[job.project_id,creativePackageId]);
    if(!r.rowCount)throw new Error('Distribution package missing for calendar.');
    const pkg=r.rows[0], scripts=Array.isArray(pkg.scripts)?pkg.scripts:[], hooks=Array.isArray(pkg.hooks)?pkg.hooks:[];
    const calendar=Array.from({length:14},(_,i)=>({
      day:i+1,
      platform:i%2===0?'TikTok':'Instagram Reels',
      creativeSpecId:String(scripts[i%scripts.length]?.id||'creative-1'),
      hookVariant:String(hooks[i%Math.max(1,hooks.length)]||'Show the use case immediately.'),
      objective:i<4?'learn hook response':i<9?'iterate strongest format':'compound winner / answer objections',
      status:'PLANNED_NOT_PUBLISHED'
    }));
    const captions=[
      'Show the use case. Keep the claim specific. Invite a real question.',
      'What would you want tested before buying this?',
      'The detail most people miss — shown, not exaggerated.',
      'Old way vs. product: which would you choose?'
    ];
    const u=await pool.query(`UPDATE distribution_packages SET calendar=$2,caption_templates=$3,status='CALENDAR_READY',updated_at=now()
      WHERE id=$1 RETURNING *`,[pkg.id,JSON.stringify(calendar),JSON.stringify(captions)]);
    return {output:{distributionPackageId:u.rows[0].id,status:'CALENDAR_READY',calendar,captions},evidenceRefs:[]};
  }

  if(job.job_type==='DISTRIBUTION_PLANNING' && step.step_type==='DISTRIBUTION_QA'){
    const creativePackageId=String(job.payload?.creativePackageId||'');
    const r=await pool.query('SELECT * FROM distribution_packages WHERE project_id=$1 AND creative_package_id=$2',[job.project_id,creativePackageId]);
    if(!r.rowCount)throw new Error('Distribution package missing for QA.');
    const pkg=r.rows[0], failures:string[]=[];
    const calendar:DistributionCalendarItem[]=Array.isArray(pkg.calendar)?pkg.calendar:[];
    if(calendar.length<10)failures.push('calendar has fewer than 10 planned posts');
    if(!calendar.some((item)=>item.platform==='TikTok'))failures.push('TikTok missing');
    if(!calendar.some((item)=>item.platform==='Instagram Reels'))failures.push('Instagram Reels missing');
    if(calendar.some((item)=>item.status!=='PLANNED_NOT_PUBLISHED'))failures.push('calendar falsely claims publishing');
    const qa={passed:failures.length===0,failures,checks:['10+ planned posts','TikTok present','Instagram Reels present','every item explicitly not published','channel plan preserves measurement loop']};
    const status=qa.passed?'READY_FOR_PUBLISHING':'QA_FAILED';
    const u=await pool.query(`UPDATE distribution_packages SET qa_result=$2,status=$3,updated_at=now() WHERE id=$1 RETURNING *`,[
      pkg.id,JSON.stringify(qa),status
    ]);
    if(!qa.passed)throw new Error(`Distribution QA failed: ${failures.join(', ')}`);
    return {output:{distributionPackageId:u.rows[0].id,status,qa},evidenceRefs:[]};
  }

  if(job.job_type==='DISTRIBUTION_PLANNING' && step.step_type==='PUBLISH_HANDOFF'){
    const creativePackageId=String(job.payload?.creativePackageId||'');
    const p=await pool.query('SELECT * FROM distribution_packages WHERE project_id=$1 AND creative_package_id=$2',[job.project_id,creativePackageId]);
    if(!p.rowCount)throw new Error('Distribution package missing for publishing handoff.');
    const connection=await pool.query(`SELECT * FROM tool_connections
      WHERE company_id=$1 AND provider IN ('SOCIAL_PUBLISHER','TIKTOK','INSTAGRAM') AND status='CONNECTED'
      ORDER BY updated_at DESC LIMIT 1`,[job.company_id]);
    if(!connection.rowCount){
      await pool.query(`UPDATE distribution_packages SET status='READY_NEEDS_SOCIAL_CONNECTION',
        external_state=$2,updated_at=now() WHERE id=$1`,[
        p.rows[0].id,JSON.stringify({tiktok:'NOT_CONNECTED',instagram:'NOT_CONNECTED',publishedCount:0,lastCheckedAt:new Date().toISOString()})
      ]);
      const existing=await pool.query(`SELECT id FROM employee_messages WHERE company_id=$1 AND work_order_id=$2
        AND type='BLOCKER' AND from_employee_slug='nova' AND to_employee_slug='ava'
        AND payload->>'reason'='SOCIAL_PUBLISHING_NOT_CONNECTED' AND consumed_at IS NULL LIMIT 1`,[
        job.company_id,job.work_order_id
      ]);
      if(!existing.rowCount){
        await pool.query(`INSERT INTO employee_messages(
          company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,authority_context,payload
        ) VALUES($1,$2,$3,'BLOCKER','nova','ava','Social publishing connection required','Connect authorized TikTok/Instagram publishing tools',$4,$5)`,[
          job.company_id,job.project_id,job.work_order_id,JSON.stringify({publishAllowed:false,spendAllowed:false}),
          JSON.stringify({distributionPackageId:p.rows[0].id,reason:'SOCIAL_PUBLISHING_NOT_CONNECTED'})
        ]);
      }
      throw new Error('BLOCKED_EXTERNAL_AUTH: Social publishing tools are not connected');
    }
    const approval=await pool.query(`INSERT INTO approvals(
      company_id,project_id,work_order_id,job_id,requested_by_employee_slug,action_type,action_payload,reason,risk,cost_cents,status
    ) VALUES($1,$2,$3,$4,'nova','SOCIAL_PUBLISH',$5,$6,'MEDIUM',0,'PENDING') RETURNING id`,[
      job.company_id,job.project_id,job.work_order_id,job.id,
      JSON.stringify({distributionPackageId:p.rows[0].id,connectionId:connection.rows[0].id}),
      'Distribution plan passed QA. Owner approval is required before public social publishing.'
    ]);
    await pool.query(`UPDATE distribution_packages SET status='NEEDS_PUBLISH_APPROVAL',
      external_state=$2,updated_at=now() WHERE id=$1`,[
      p.rows[0].id,JSON.stringify({publisher:'CONNECTED',publishedCount:0,approvalId:approval.rows[0].id})
    ]);
    await pool.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[job.work_order_id]);
    return {output:{status:'WAITING_APPROVAL',approvalId:approval.rows[0].id,distributionPackageId:p.rows[0].id},evidenceRefs:[]};
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
    const evidenceRefs:string[]=[...new Set<string>(refsR.rows.flatMap((row:{evidence_refs:unknown})=>Array.isArray(row.evidence_refs)?row.evidence_refs.map(String):[]))];

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

    const intelligence=await getEmployeeIntelligenceContext(job.company_id,job.employee_slug);
    const result=await executeStep(job,step,intelligence);
    const appliedIntelligence={
      employee:job.employee_slug,
      reasoning:{
        firstPrinciples:intelligence.profile.firstPrinciples,
        forwardHorizonSteps:intelligence.profile.forwardHorizonSteps,
        uncertaintyPolicy:intelligence.profile.uncertaintyPolicy,
        learningPolicy:intelligence.profile.learningPolicy
      },
      trainingLessonIds:intelligence.lessons.map((lesson)=>lesson.id),
      trainingSourceIds:[...new Set(intelligence.lessons.map((lesson)=>lesson.sourceId))]
    };
    const output=(typeof result.output==='object'&&result.output!==null)
      ?{...(result.output as Record<string,unknown>),appliedIntelligence}
      :{value:result.output,appliedIntelligence};
    await stepSuccess(step.id,output,result.evidenceRefs);

    const outputStatus=resultStatus(output);
    if(outputStatus.startsWith('BLOCKED') || outputStatus.startsWith('WAITING_')){
      await pool.query(`UPDATE jobs SET status='BLOCKED',last_error=$2,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id,outputStatus]);
      await pool.query(`UPDATE work_orders SET status='BLOCKED',blockers=$2,updated_at=now() WHERE id=$1`,[job.work_order_id,JSON.stringify([outputStatus])]);
      await emitEvent(job.company_id,'JOB_BLOCKED',{jobId:job.id,workOrderId:job.work_order_id,reason:outputStatus});
      return {processed:true,jobId:job.id,status:'BLOCKED'};
    }

    await pool.query(`UPDATE jobs SET status='QUEUED',scheduled_for=now(),lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[job.id]);
    await emitEvent(job.company_id,'JOB_STEP_SUCCEEDED',{jobId:job.id,stepId:step.id,stepType:step.step_type});
    return {processed:true,jobId:job.id,status:'STEP_SUCCEEDED'};
  }catch(e){
    const message=e instanceof Error?e.message:'Unknown worker error';
    const blockedExternalAuth=message.startsWith('BLOCKED_EXTERNAL_AUTH:');
    const terminal=blockedExternalAuth || job.retry_count>=job.max_attempts || !retryable(message);
    const jobStatus=blockedExternalAuth ? 'BLOCKED' : terminal ? 'FAILED' : 'RETRY_SCHEDULED';
    const stepStatus=blockedExternalAuth ? 'BLOCKED' : terminal ? 'FAILED' : 'WAITING';

    await pool.query(`UPDATE job_steps
      SET status=$2,last_error=$3,attempt_history=attempt_history || $4::jsonb,updated_at=now()
      WHERE job_id=$1 AND status='RUNNING'`,
      [job.id,stepStatus,message,JSON.stringify([{at:new Date().toISOString(),result:jobStatus,error:message}])]);

    await pool.query(`UPDATE jobs SET status=$2,last_error=$3,
      scheduled_for=CASE WHEN $2='RETRY_SCHEDULED' THEN now()+interval '2 minutes' ELSE scheduled_for END,
      retry_count=CASE WHEN $2='RETRY_SCHEDULED' THEN retry_count+1 ELSE retry_count END,
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
