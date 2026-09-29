import { tx } from './db.js';

type ManagerMessageRow={
  id:string;company_id:string;project_id:string|null;work_order_id:string|null;type:string;
  from_employee_slug:string;to_employee_slug:string;objective:string;required_output:string|null;
  evidence_refs:unknown[];authority_context:Record<string,unknown>;payload:Record<string,unknown>;created_at:string;consumed_at:string|null;
};

export async function processOneManagerMessage(){
  return tx(async c=>{
    const r=await c.query<ManagerMessageRow>(`SELECT * FROM employee_messages
      WHERE to_employee_slug='ava' AND consumed_at IS NULL
      AND type IN ('WORK_RESULT','BLOCKER','ESCALATION','REVIEW_REQUEST')
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1`);
    if(!r.rowCount)return {processed:false as const};
    const message=r.rows[0]!;
    const payload=message.payload||{};

    if(message.type==='WORK_RESULT' && payload.storePackageId && message.project_id && message.work_order_id){
      const storeR=await c.query(`SELECT s.*,p.name candidate_name FROM store_packages s
        JOIN product_candidates p ON p.id=s.candidate_id
        WHERE s.id=$1 AND s.company_id=$2 AND s.project_id=$3`,[
        payload.storePackageId,message.company_id,message.project_id
      ]);
      if(storeR.rowCount && storeR.rows[0].qa_result?.passed===true){
        const store=storeR.rows[0];
        let work=await c.query(`SELECT * FROM work_orders
          WHERE company_id=$1 AND project_id=$2 AND assigned_employee_slug='maya'
          AND objective LIKE 'Create launch creative system%' ORDER BY created_at DESC LIMIT 1`,[
          message.company_id,message.project_id
        ]);
        if(!work.rowCount){
          work=await c.query(`INSERT INTO work_orders(
            company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
          ) VALUES($1,$2,'ava','maya',$3,'READY','MEDIUM',$4) RETURNING *`,[
            message.company_id,message.project_id,`Create launch creative system for ${store.candidate_name}`,
            JSON.stringify(['10+ hooks','6+ structured scripts','storyboard for every script','creative QA passes','render state remains truthful','no publishing without approval'])
          ]);
        }
        const wo=work.rows[0];

        let job=await c.query(`SELECT * FROM jobs WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1`,[
          message.company_id,`creative-production:${store.id}`
        ]);
        if(!job.rowCount){
          job=await c.query(`INSERT INTO jobs(
            company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key
          ) VALUES($1,$2,$3,'maya','CREATIVE_PRODUCTION',$4,$5) RETURNING *`,[
            message.company_id,message.project_id,wo.id,
            JSON.stringify({storePackageId:store.id,candidateId:store.candidate_id,candidate:store.candidate_name}),
            `creative-production:${store.id}`
          ]);
          const steps=['CREATIVE_STRATEGY','HOOK_LIBRARY','SCRIPT_PACK','STORYBOARDS','CREATIVE_QA','RENDER_HANDOFF','RENDER_EXECUTE'];
          for(let i=0;i<steps.length;i++){
            await c.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,input)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,sequence) DO NOTHING`,[
              message.company_id,job.rows[0].id,i+1,steps[i],
              JSON.stringify({storePackageId:store.id,candidateId:store.candidate_id})
            ]);
          }
          await c.query(`INSERT INTO employee_messages(
            company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
            evidence_refs,authority_context,payload
          ) VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','maya',$4,'QA-passed creative production package',$5,$6,$7)`,[
            message.company_id,message.project_id,wo.id,`Create the organic launch creative system for ${store.candidate_name}`,
            JSON.stringify(message.evidence_refs||[]),
            JSON.stringify({risk:'MEDIUM',publishAllowed:false,spendAllowed:false,storeQaPassed:true}),
            JSON.stringify({jobId:job.rows[0].id,storePackageId:store.id,candidateId:store.candidate_id})
          ]);
          await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'CREATIVE_WORK_ASSIGNED',$2)`,[
            message.company_id,JSON.stringify({projectId:message.project_id,workOrderId:wo.id,jobId:job.rows[0].id,from:'ava',to:'maya'})
          ]);
        }
      }
    }else if(message.type==='WORK_RESULT' && payload.creativePackageId && message.project_id && message.work_order_id){
      const creativeR=await c.query(`SELECT c.*,p.name candidate_name FROM creative_packages c
        JOIN product_candidates p ON p.id=c.candidate_id
        WHERE c.id=$1 AND c.company_id=$2 AND c.project_id=$3`,[
        payload.creativePackageId,message.company_id,message.project_id
      ]);
      if(creativeR.rowCount && creativeR.rows[0].qa_result?.passed===true){
        const creative=creativeR.rows[0];
        let work=await c.query(`SELECT * FROM work_orders
          WHERE company_id=$1 AND project_id=$2 AND assigned_employee_slug='nova'
          AND objective LIKE 'Plan organic distribution%' ORDER BY created_at DESC LIMIT 1`,[
          message.company_id,message.project_id
        ]);
        if(!work.rowCount){
          work=await c.query(`INSERT INTO work_orders(
            company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
          ) VALUES($1,$2,'ava','nova',$3,'READY','MEDIUM',$4) RETURNING *`,[
            message.company_id,message.project_id,`Plan organic distribution for ${creative.candidate_name}`,
            JSON.stringify(['TikTok plan','Instagram Reels plan','10+ item calendar','distribution QA passes','published state remains truthful','public publishing requires approval'])
          ]);
        }
        const wo=work.rows[0];

        let job=await c.query(`SELECT * FROM jobs WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1`,[
          message.company_id,`distribution-planning:${creative.id}`
        ]);
        if(!job.rowCount){
          job=await c.query(`INSERT INTO jobs(
            company_id,project_id,work_order_id,employee_slug,job_type,payload,idempotency_key
          ) VALUES($1,$2,$3,'nova','DISTRIBUTION_PLANNING',$4,$5) RETURNING *`,[
            message.company_id,message.project_id,wo.id,
            JSON.stringify({creativePackageId:creative.id,candidateId:creative.candidate_id,candidate:creative.candidate_name}),
            `distribution-planning:${creative.id}`
          ]);
          const steps=['CHANNEL_PLAN','CONTENT_CALENDAR','DISTRIBUTION_QA','PUBLISH_HANDOFF'];
          for(let i=0;i<steps.length;i++){
            await c.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,input)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,sequence) DO NOTHING`,[
              message.company_id,job.rows[0].id,i+1,steps[i],
              JSON.stringify({creativePackageId:creative.id,candidateId:creative.candidate_id})
            ]);
          }
          await c.query(`INSERT INTO employee_messages(
            company_id,project_id,work_order_id,type,from_employee_slug,to_employee_slug,objective,required_output,
            evidence_refs,authority_context,payload
          ) VALUES($1,$2,$3,'WORK_ASSIGNMENT','ava','nova',$4,'QA-passed distribution package',$5,$6,$7)`,[
            message.company_id,message.project_id,wo.id,`Build the organic distribution plan for ${creative.candidate_name}`,
            JSON.stringify(message.evidence_refs||[]),
            JSON.stringify({risk:'MEDIUM',publishAllowed:false,spendAllowed:false,creativeQaPassed:true}),
            JSON.stringify({jobId:job.rows[0].id,creativePackageId:creative.id,candidateId:creative.candidate_id})
          ]);
          await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'DISTRIBUTION_WORK_ASSIGNED',$2)`,[
            message.company_id,JSON.stringify({projectId:message.project_id,workOrderId:wo.id,jobId:job.rows[0].id,from:'ava',to:'nova'})
          ]);
        }
      }
    }else if(message.type==='WORK_RESULT' && payload.candidateId && message.project_id && message.work_order_id){
      const candidateR=await c.query(`SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2 AND project_id=$3`,
        [payload.candidateId,message.company_id,message.project_id]);
      if(candidateR.rowCount){
        const candidate=candidateR.rows[0];
        const eligible=['VERIFIED_CANDIDATE','LAUNCH_REVIEW'].includes(candidate.status);
        if(eligible){
          const existing=await c.query(`SELECT id,status FROM approvals
            WHERE company_id=$1 AND project_id=$2 AND action_type='PRODUCT_GATE'
            ORDER BY created_at DESC LIMIT 1`,[message.company_id,message.project_id]);
          if(!existing.rowCount){
            const approval=await c.query(`INSERT INTO approvals(
              company_id,project_id,work_order_id,requested_by_employee_slug,action_type,action_payload,
              reason,risk,cost_cents,status
            ) VALUES($1,$2,$3,'ava','PRODUCT_GATE',$4,$5,'MEDIUM',0,'PENDING') RETURNING id`,[
              message.company_id,message.project_id,message.work_order_id,
              JSON.stringify({candidateId:candidate.id,candidate:candidate.name,score:candidate.score,confidence:candidate.confidence}),
              `Ava reviewed Rowan's evidence-backed candidate. ${candidate.name} scored ${candidate.score}/100 with ${candidate.confidence} confidence. Owner approval is required before store work begins.`
            ]);
            await c.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[message.work_order_id]);
            await c.query(`UPDATE projects SET phase='PRODUCT_GATE',updated_at=now() WHERE id=$1`,[message.project_id]);
            await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'PRODUCT_GATE_REQUIRED',$2)`,[
              message.company_id,JSON.stringify({approvalId:approval.rows[0].id,candidateId:candidate.id,projectId:message.project_id,sourceMessageId:message.id})
            ]);
          }else{
            await c.query(`UPDATE projects SET phase='PRODUCT_GATE',updated_at=now() WHERE id=$1`,[message.project_id]);
            if(existing.rows[0].status==='PENDING'){
              await c.query(`UPDATE work_orders SET status='NEEDS_APPROVAL',blockers='[]'::jsonb,updated_at=now() WHERE id=$1`,[message.work_order_id]);
            }
          }

          await c.query(`INSERT INTO memories(company_id,employee_slug,type,subject,content,source,confidence,created_by,last_verified_at)
            VALUES($1,'ava','EMPLOYEE_INTERPRETATION',$2,$3,$4,$5,'ava',now())`,[
              message.company_id,
              `Product candidate: ${candidate.name}`,
              `Rowan verified ${candidate.name} as ${candidate.status} with score ${candidate.score}/100. This is a research interpretation pending owner product-gate decision.`,
              `product_candidate:${candidate.id}`,
              candidate.confidence
            ]);
        }else{
          await c.query(`UPDATE projects SET phase='RESEARCH_ITERATION',updated_at=now() WHERE id=$1`,[message.project_id]);
          await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'MANAGER_RESEARCH_ITERATION',$2)`,[
            message.company_id,JSON.stringify({candidateId:candidate.id,status:candidate.status,sourceMessageId:message.id})
          ]);
        }
      }
    }else if(message.type==='BLOCKER' || message.type==='ESCALATION'){
      await c.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'MANAGER_ESCALATION_RECEIVED',$2)`,[
        message.company_id,JSON.stringify({messageId:message.id,type:message.type,from:message.from_employee_slug,objective:message.objective})
      ]);
    }

    await c.query('UPDATE employee_messages SET consumed_at=now() WHERE id=$1',[message.id]);
    return {processed:true as const,messageId:message.id,type:message.type};
  });
}
