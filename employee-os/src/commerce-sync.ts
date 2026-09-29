import { pool } from './db.js';
import { connectedShopifyCompanies,listPaidUnfulfilledOrders,syncShopifyFulfillmentTracking,type ShopifyPaidOrder } from './shopify-executor.js';
import { createCJOrderForShopify,getCJOrderDetail,payCJOrder } from './cj-executor.js';

function externalOrderNumber(companyId:string,shopifyOrderId:string){
  const tail=shopifyOrderId.split('/').pop()||shopifyOrderId;
  return `EOS-${companyId.replace(/-/g,'').slice(0,8)}-${tail}`.slice(0,50);
}

async function orderMappings(companyId:string,order:ShopifyPaidOrder){
  const lines:any[]=[];
  for(const line of order.lineItems.nodes){
    const productId=line.variant?.product?.id||'';
    if(!productId) return {ok:false as const,reason:`Line ${line.id} has no Shopify product ID.`,lines:[]};
    const r=await pool.query(`SELECT sp.project_id,sp.work_order_id,sp.candidate_id,sp.external_state,m.*
      FROM store_packages sp
      JOIN supplier_product_mappings m
        ON m.company_id=sp.company_id AND m.candidate_id=sp.candidate_id AND m.provider='CJ'
      WHERE sp.company_id=$1 AND sp.external_state->>'productId'=$2
        AND sp.status='LIVE'
        AND m.status IN ('VERIFIED','VERIFIED_WITH_UNVERIFIED_STOCK')
      ORDER BY m.verified_at DESC NULLS LAST LIMIT 1`,[companyId,productId]);
    if(!r.rowCount){
      return {ok:false as const,reason:`No verified CJ mapping for Shopify product ${productId}.`,lines:[]};
    }
    lines.push({
      mappingId:String(r.rows[0].id),
      projectId:String(r.rows[0].project_id),
      workOrderId:String(r.rows[0].work_order_id),
      candidateId:String(r.rows[0].candidate_id),
      quantity:Number(line.quantity),
      shippingName:String(line.name||line.sku||'Product')
    });
  }
  return {ok:true as const,lines};
}

async function ensurePaymentApproval(input:{
  companyId:string;fulfillmentOrderId:string;projectId:string|null;workOrderId:string|null;
  supplierOrderId:string;shopifyOrderId:string;shopifyOrderName:string;amount:number;
}){
  const existing=await pool.query(`SELECT id FROM approvals
    WHERE company_id=$1 AND action_type='CJ_ORDER_PAYMENT'
      AND action_payload->>'fulfillmentOrderId'=$2
    ORDER BY created_at DESC LIMIT 1`,[input.companyId,input.fulfillmentOrderId]);
  if(existing.rowCount)return existing.rows[0].id;
  const approval=await pool.query(`INSERT INTO approvals(
    company_id,project_id,work_order_id,requested_by_employee_slug,action_type,action_payload,
    reason,risk,cost_cents,status
  ) VALUES($1,$2,$3,'ava','CJ_ORDER_PAYMENT',$4,$5,'HIGH',$6,'PENDING') RETURNING id`,[
    input.companyId,input.projectId,input.workOrderId,
    JSON.stringify({
      fulfillmentOrderId:input.fulfillmentOrderId,
      supplierOrderId:input.supplierOrderId,
      shopifyOrderId:input.shopifyOrderId
    }),
    `Customer order ${input.shopifyOrderName} is ready at CJdropshipping. Approve supplier payment before money is spent.`,
    Math.max(0,Math.round(input.amount*100))
  ]);
  return approval.rows[0].id;
}

async function createFulfillment(companyId:string,order:ShopifyPaidOrder){
  const idempotencyKey=`shopify-order:${order.id}`;
  let existing=await pool.query(`SELECT * FROM fulfillment_orders
    WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1`,[companyId,idempotencyKey]);
  if(existing.rowCount){
    const row=existing.rows[0];
    if(row.supplier_order_id){
      if(row.status==='NEEDS_PAYMENT_APPROVAL'){
        await ensurePaymentApproval({
          companyId,fulfillmentOrderId:String(row.id),projectId:null,workOrderId:null,
          supplierOrderId:String(row.supplier_order_id),shopifyOrderId:order.id,shopifyOrderName:order.name,
          amount:Number(row.amount||0)
        });
      }
      return {processed:false,status:row.status,id:row.id};
    }
    if(['BLOCKED_UNMAPPED_LINE','BLOCKED_CUSTOMER_DATA'].includes(String(row.status))){
      return {processed:false,status:row.status,id:row.id};
    }
  }

  const mapping=await orderMappings(companyId,order);
  if(!mapping.ok){
    const row=await pool.query(`INSERT INTO fulfillment_orders(
      company_id,provider,shopify_order_id,shopify_order_name,status,raw_state,idempotency_key
    ) VALUES($1,'CJ',$2,$3,'BLOCKED_UNMAPPED_LINE',$4,$5)
    ON CONFLICT(company_id,idempotency_key) DO UPDATE SET
      status='BLOCKED_UNMAPPED_LINE',raw_state=EXCLUDED.raw_state,updated_at=now()
    RETURNING *`,[companyId,order.id,order.name,JSON.stringify({reason:mapping.reason}),idempotencyKey]);
    await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_BLOCKED',$2)`,[
      companyId,JSON.stringify({shopifyOrderId:order.id,reason:mapping.reason})
    ]);
    return {processed:true,status:'BLOCKED_UNMAPPED_LINE',id:row.rows[0].id};
  }

  if(!order.shippingAddress?.phone){
    const row=await pool.query(`INSERT INTO fulfillment_orders(
      company_id,provider,shopify_order_id,shopify_order_name,mapping_id,status,raw_state,idempotency_key
    ) VALUES($1,'CJ',$2,$3,$4,'BLOCKED_CUSTOMER_DATA',$5,$6)
    ON CONFLICT(company_id,idempotency_key) DO UPDATE SET
      status='BLOCKED_CUSTOMER_DATA',raw_state=EXCLUDED.raw_state,updated_at=now()
    RETURNING *`,[
      companyId,order.id,order.name,mapping.lines[0]?.mappingId||null,
      JSON.stringify({reason:'Customer shipping phone number is required by CJdropshipping.'}),idempotencyKey
    ]);
    await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_BLOCKED',$2)`,[
      companyId,JSON.stringify({shopifyOrderId:order.id,reason:'CUSTOMER_PHONE_REQUIRED'})
    ]);
    return {processed:true,status:'BLOCKED_CUSTOMER_DATA',id:row.rows[0].id};
  }

  const extNumber=externalOrderNumber(companyId,order.id);
  if(!existing.rowCount){
    existing=await pool.query(`INSERT INTO fulfillment_orders(
      company_id,provider,shopify_order_id,shopify_order_name,mapping_id,status,raw_state,idempotency_key,
      supplier_order_number
    ) VALUES($1,'CJ',$2,$3,$4,'CREATING',$5,$6,$7) RETURNING *`,[
      companyId,order.id,order.name,mapping.lines[0]?.mappingId||null,
      JSON.stringify({externalOrderNumber:extNumber}),idempotencyKey,extNumber
    ]);
  }

  const fulfillmentId=String(existing.rows[0].id);
  try{
    if(String(existing.rows[0].status)==='CREATING'){
      try{
        const recovered=await getCJOrderDetail(companyId,extNumber);
        if(recovered?.orderId){
          const status='NEEDS_PAYMENT_APPROVAL';
          const updated=await pool.query(`UPDATE fulfillment_orders SET
            supplier_order_id=$2,supplier_order_number=$3,status=$4,amount=$5,
            tracking_number=$6,tracking_url=$7,raw_state=$8,updated_at=now()
            WHERE id=$1 RETURNING *`,[
            fulfillmentId,recovered.orderId,recovered.cjOrderCode||extNumber,status,recovered.amount,
            recovered.trackingNumber||null,recovered.trackingUrl||null,JSON.stringify(recovered.raw||{})
          ]);
          const first=mapping.lines[0];
          await ensurePaymentApproval({
            companyId,fulfillmentOrderId:fulfillmentId,projectId:first?.projectId||null,workOrderId:first?.workOrderId||null,
            supplierOrderId:recovered.orderId,shopifyOrderId:order.id,shopifyOrderName:order.name,amount:recovered.amount
          });
          return {processed:true,status,fulfillment:updated.rows[0],recovered:true};
        }
      }catch{
        // No recoverable CJ order exists for this deterministic external number; safe to create below.
      }
    }

    const created=await createCJOrderForShopify({
      companyId,
      shopifyOrderId:order.id,
      shopifyOrderName:order.name,
      externalOrderNumber:extNumber,
      shippingAddress:{
        name:order.shippingAddress!.name,
        address1:order.shippingAddress!.address1,
        address2:order.shippingAddress!.address2,
        city:order.shippingAddress!.city,
        province:order.shippingAddress!.province,
        zip:order.shippingAddress!.zip,
        country:order.shippingAddress!.country,
        countryCodeV2:order.shippingAddress!.countryCodeV2,
        phone:order.shippingAddress!.phone
      },
      lines:mapping.lines.map((line)=>({
        mappingId:line.mappingId,quantity:line.quantity,shippingName:line.shippingName
      }))
    });
    const updated=await pool.query(`UPDATE fulfillment_orders SET
      supplier_order_id=$2,supplier_order_number=$3,status='NEEDS_PAYMENT_APPROVAL',amount=$4,
      tracking_number=$5,tracking_url=$6,raw_state=$7,updated_at=now()
      WHERE id=$1 RETURNING *`,[
      fulfillmentId,created.orderId,created.cjOrderCode||created.orderNumber,created.amount,
      created.trackingNumber||null,created.trackingUrl||null,JSON.stringify(created.raw||{})
    ]);
    const first=mapping.lines[0];
    const approvalId=await ensurePaymentApproval({
      companyId,fulfillmentOrderId:fulfillmentId,projectId:first?.projectId||null,workOrderId:first?.workOrderId||null,
      supplierOrderId:created.orderId,shopifyOrderId:order.id,shopifyOrderName:order.name,amount:created.amount
    });
    await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_ORDER_CREATED',$2)`,[
      companyId,JSON.stringify({fulfillmentOrderId:fulfillmentId,shopifyOrderId:order.id,cjOrderId:created.orderId,approvalId})
    ]);
    return {processed:true,status:'NEEDS_PAYMENT_APPROVAL',fulfillment:updated.rows[0],approvalId};
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown CJ creation error';
    await pool.query(`UPDATE fulfillment_orders SET status='CREATE_RETRY',raw_state=$2,updated_at=now() WHERE id=$1`,[
      fulfillmentId,JSON.stringify({error:message,externalOrderNumber:extNumber})
    ]);
    throw error;
  }
}

export async function pollPaidShopifyOrdersOnce(){
  const companies=await connectedShopifyCompanies();
  let processed=0;
  for(const connection of companies){
    const companyId=String(connection.company_id);
    try{
      const orders=await listPaidUnfulfilledOrders(companyId);
      for(const order of orders.slice(0,10)){
        const result=await createFulfillment(companyId,order);
        if(result.processed)processed++;
      }
      await pool.query(`UPDATE tool_connections SET metadata=jsonb_set(metadata,'{lastOrderPollAt}',to_jsonb(now()::text),true),updated_at=now()
        WHERE id=$1`,[connection.id]);
    }catch(error){
      const message=error instanceof Error?error.message:'Order poll failed';
      await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'COMMERCE_SYNC_ERROR',$2)`,[
        companyId,JSON.stringify({stage:'SHOPIFY_ORDER_POLL',error:message})
      ]);
    }
  }
  return {processed};
}

export async function processApprovedCJPaymentsOnce(){
  const r=await pool.query(`SELECT * FROM fulfillment_orders
    WHERE provider='CJ' AND status='PAYMENT_APPROVED' AND supplier_order_id IS NOT NULL
    ORDER BY updated_at ASC LIMIT 10`);
  let processed=0;
  for(const row of r.rows){
    try{
      await payCJOrder(String(row.company_id),String(row.supplier_order_id));
      const detail=await getCJOrderDetail(String(row.company_id),String(row.supplier_order_id));
      await pool.query(`UPDATE fulfillment_orders SET status=$2,amount=$3,tracking_number=$4,tracking_url=$5,
        raw_state=$6,updated_at=now() WHERE id=$1`,[
        row.id,detail.orderStatus==='UNKNOWN'?'PAID':detail.orderStatus,detail.amount||row.amount,
        detail.trackingNumber||null,detail.trackingUrl||null,JSON.stringify(detail.raw||{})
      ]);
      await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_PAYMENT_EXECUTED',$2)`,[
        row.company_id,JSON.stringify({fulfillmentOrderId:row.id,cjOrderId:row.supplier_order_id,status:detail.orderStatus})
      ]);
      processed++;
    }catch(error){
      const message=error instanceof Error?error.message:'CJ payment failed';
      await pool.query(`UPDATE fulfillment_orders SET status='PAYMENT_FAILED',
        raw_state=jsonb_set(raw_state,'{paymentError}',to_jsonb($2::text),true),updated_at=now() WHERE id=$1`,[
        row.id,message
      ]);
      await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_PAYMENT_FAILED',$2)`,[
        row.company_id,JSON.stringify({fulfillmentOrderId:row.id,error:message})
      ]);
    }
  }
  return {processed};
}

export async function syncCJFulfillmentOnce(){
  const r=await pool.query(`SELECT * FROM fulfillment_orders
    WHERE provider='CJ' AND supplier_order_id IS NOT NULL
      AND status NOT IN ('PAYMENT_REJECTED','CANCELLED','DELIVERED')
    ORDER BY updated_at ASC LIMIT 20`);
  let processed=0;
  for(const row of r.rows){
    try{
      const detail=await getCJOrderDetail(String(row.company_id),String(row.supplier_order_id));
      const previousTracking=String(row.tracking_number||'');
      await pool.query(`UPDATE fulfillment_orders SET
        status=CASE WHEN status IN ('NEEDS_PAYMENT_APPROVAL','PAYMENT_APPROVED') THEN status ELSE $2 END,
        amount=CASE WHEN $3>0 THEN $3 ELSE amount END,
        tracking_number=NULLIF($4,''),tracking_url=NULLIF($5,''),raw_state=$6,updated_at=now()
        WHERE id=$1`,[
        row.id,detail.orderStatus,detail.amount,detail.trackingNumber,detail.trackingUrl,JSON.stringify(detail.raw||{})
      ]);

      if(detail.trackingNumber){
        const currentShopify=Array.isArray(row.shopify_fulfillments)?row.shopify_fulfillments:[];
        const needsShopifySync=!row.shopify_tracking_synced_at||detail.trackingNumber!==previousTracking||!currentShopify.length;
        if(needsShopifySync){
          const shopifyFulfillments=await syncShopifyFulfillmentTracking({
            companyId:String(row.company_id),
            shopifyOrderId:String(row.shopify_order_id),
            trackingNumber:detail.trackingNumber,
            trackingUrl:detail.trackingUrl||null,
            trackingCompany:String(detail.trackingProvider||'')||null,
            existingFulfillments:currentShopify
          });
          await pool.query(`UPDATE fulfillment_orders SET shopify_fulfillments=$2,
            shopify_tracking_synced_at=now(),updated_at=now() WHERE id=$1`,[
            row.id,JSON.stringify(shopifyFulfillments)
          ]);
          await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'SHOPIFY_FULFILLMENT_SYNCED',$2)`,[
            row.company_id,JSON.stringify({
              fulfillmentOrderId:row.id,shopifyOrderId:row.shopify_order_id,
              shopifyFulfillments,trackingNumber:detail.trackingNumber
            })
          ]);
        }
      }
      if(detail.trackingNumber&&detail.trackingNumber!==previousTracking){
        await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'FULFILLMENT_TRACKING_UPDATED',$2)`,[
          row.company_id,JSON.stringify({
            fulfillmentOrderId:row.id,shopifyOrderId:row.shopify_order_id,
            trackingNumber:detail.trackingNumber,trackingUrl:detail.trackingUrl,status:detail.orderStatus
          })
        ]);
      }
      processed++;
    }catch(error){
      const message=error instanceof Error?error.message:'CJ tracking sync failed';
      await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'COMMERCE_SYNC_ERROR',$2)`,[
        row.company_id,JSON.stringify({stage:'CJ_TRACKING_SYNC',fulfillmentOrderId:row.id,error:message})
      ]);
    }
  }
  return {processed};
}
