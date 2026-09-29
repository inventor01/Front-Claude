import { tx } from './db.js';

type ManagerMessageRow={
  id:string;company_id:string;project_id:string|null;work_order_id:string|null;type:string;
  from_employee_slug:string;to_employee_slug:string;objective:string;required_output:string|null;
  evidence_refs:any;authority_context:any;payload:any;created_at:string;consumed_at:string|null;
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

    if(message.type==='WORK_RESULT' && payload.candidateId && message.project_id && message.work_order_id){
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
