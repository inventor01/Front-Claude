import { runOne } from './engine.js';
import { processOneManagerMessage } from './manager.js';
import { pollPaidShopifyOrdersOnce,processApprovedCJPaymentsOnce,syncCJFulfillmentOnce } from './commerce-sync.js';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let nextCommerceSyncAt=0;
const requestedCommerceInterval=Number(process.env.COMMERCE_SYNC_INTERVAL_MS||60_000);
const COMMERCE_SYNC_INTERVAL_MS=process.env.PROVIDER_TEST_MODE==='1'
  ?Math.max(250,requestedCommerceInterval)
  :Math.max(10_000,requestedCommerceInterval);
console.log('employee worker started');

for(;;){
  try{
    let processed=0;
    for(let i=0;i<5;i++){
      const r=await runOne();
      if(!r.processed)break;
      processed++;
    }
    for(let i=0;i<5;i++){
      const m=await processOneManagerMessage();
      if(!m.processed)break;
      processed++;
    }
    if(Date.now()>=nextCommerceSyncAt){
      nextCommerceSyncAt=Date.now()+COMMERCE_SYNC_INTERVAL_MS;
      const orders=await pollPaidShopifyOrdersOnce();
      processed+=orders.processed;
      const payments=await processApprovedCJPaymentsOnce();
      processed+=payments.processed;
      const tracking=await syncCJFulfillmentOnce();
      processed+=tracking.processed;
    }
    if(!processed)await sleep(3000);
  }catch(e){
    console.error('worker loop error',e);
    await sleep(5000);
  }
}
