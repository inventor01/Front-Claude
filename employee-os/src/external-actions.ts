import { pool } from './db.js';

export type ExternalActionContext={
  companyId:string;
  jobId?:string|null;
  workOrderId?:string|null;
  employeeSlug?:string|null;
  provider:string;
  actionType:string;
  target?:string|null;
  idempotencyKey:string;
};

export async function startExternalAction(ctx:ExternalActionContext){
  const inserted=await pool.query(`
    INSERT INTO external_actions(
      company_id,job_id,work_order_id,employee_slug,provider,action_type,target,idempotency_key,status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PREPARED')
    ON CONFLICT(company_id,idempotency_key) DO NOTHING
    RETURNING *
  `,[
    ctx.companyId,ctx.jobId||null,ctx.workOrderId||null,ctx.employeeSlug||null,
    ctx.provider,ctx.actionType,ctx.target||null,ctx.idempotencyKey
  ]);
  const row=inserted.rowCount
    ? inserted.rows[0]
    : (await pool.query(
        'SELECT * FROM external_actions WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1',
        [ctx.companyId,ctx.idempotencyKey]
      )).rows[0];
  if(!row)throw new Error('External action ledger entry could not be created.');
  if(row.status==='SUCCEEDED')return {action:row,reused:true,result:row.result};
  if(row.status==='RECONCILIATION_REQUIRED'||row.status==='RUNNING'){
    throw new Error(`BLOCKED_EXTERNAL_RECONCILIATION: ${ctx.provider} action requires provider reconciliation before retry.`);
  }
  if(row.status==='FAILED'){
    throw new Error(`BLOCKED_EXTERNAL_FAILED: ${ctx.provider} action failed terminally; create an explicit new action/version to retry.`);
  }
  const running=(await pool.query(`
    UPDATE external_actions
    SET status='RUNNING',attempt_count=attempt_count+1,last_error=NULL,
        started_at=COALESCE(started_at,now()),
        provider_external_id=provider_external_id,
        updated_at=now()
    WHERE id=$1 RETURNING *
  `,[row.id])).rows[0];
  return {action:running,reused:false,result:null};
}

export async function markExternalWaiting(actionId:string,providerExternalId:string,result:unknown={}){
  return (await pool.query(`
    UPDATE external_actions SET status='WAITING_EXTERNAL',provider_external_id=$2,result=$3,updated_at=now()
    WHERE id=$1 RETURNING *
  `,[actionId,providerExternalId,JSON.stringify(result)])).rows[0];
}

export async function completeExternalAction(actionId:string,providerExternalId:string|null,result:unknown){
  return (await pool.query(`
    UPDATE external_actions SET status='SUCCEEDED',provider_external_id=COALESCE($2,provider_external_id),
      result=$3,last_error=NULL,completed_at=now(),updated_at=now()
    WHERE id=$1 RETURNING *
  `,[actionId,providerExternalId,JSON.stringify(result)])).rows[0];
}

export async function failExternalAction(actionId:string,error:string,status:'FAILED'|'RETRYABLE_FAILURE'|'RECONCILIATION_REQUIRED'='FAILED'){
  return (await pool.query(`
    UPDATE external_actions SET status=$2,last_error=$3,updated_at=now()
    WHERE id=$1 RETURNING *
  `,[actionId,status,error])).rows[0];
}
