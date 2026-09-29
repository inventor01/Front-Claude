import http from 'node:http';
import {spawn} from 'node:child_process';
import pg from 'pg';
const {Pool}=pg;

const MOCK_PORT=4300;
const API_PORT=4310;
const mock={
  productCreated:false,
  published:false,
  productSetCalls:0,
  publishCalls:0,
  createOrderCalls:0,
  payCalls:0,
  pages:new Map(),
  cjOrder:null,
  cjPaid:false
};

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
  res.end(body);
}
function cj(res,data,message='Success'){json(res,200,{code:200,result:true,message,data,requestId:'qa'});}
function cjFail(res,message='Not found'){json(res,200,{code:1600100,result:false,message,data:null,requestId:'qa'});}

const shopifyScopes=[
  'read_products','write_products','read_orders','read_publications','write_publications',
  'read_content','write_content','read_online_store_pages','write_online_store_pages'
];

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${MOCK_PORT}`);
  const chunks=[]; for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString('utf8');
  let body={}; try{body=raw?JSON.parse(raw):{};}catch{}

  if(req.method==='POST'&&url.pathname==='/admin/api/2026-07/graphql.json'){
    const query=String(body.query||'');
    if(query.includes('EmployeeOSConnectionCheck')){
      return json(res,200,{data:{
        shop:{name:'Employee OS QA Store',myshopifyDomain:'employee-os-qa.myshopify.com',currencyCode:'USD',
          primaryDomain:{url:`http://127.0.0.1:${MOCK_PORT}`,host:'127.0.0.1'}},
        publications:{nodes:[{id:'gid://shopify/Publication/1',catalog:{title:'Online Store',status:'ACTIVE'}}]},
        currentAppInstallation:{accessScopes:shopifyScopes.map(handle=>({handle}))}
      }});
    }
    if(query.includes('BuildProduct')){
      mock.productSetCalls++; mock.productCreated=true;
      return json(res,200,{data:{productSet:{product:{
        id:'gid://shopify/Product/1001',handle:'car-diffuser',title:'Car Diffuser',status:'ACTIVE',
        variants:{nodes:[{id:'gid://shopify/ProductVariant/2001',price:'39.99'}]}
      },userErrors:[]}}});
    }
    if(query.includes('PublishProduct')){
      mock.publishCalls++; mock.published=true;
      return json(res,200,{data:{publishablePublish:{publishable:{publishedOnPublication:true},userErrors:[]}}});
    }
    if(query.includes('ExistingPages')){
      const q=String(body.variables?.query||'');
      const handle=q.replace(/^handle:/,'');
      const p=mock.pages.get(handle);
      return json(res,200,{data:{pages:{nodes:p?[p]:[]}}});
    }
    if(query.includes('CreatePage')){
      const page=body.variables?.page||{};
      const p={id:`gid://shopify/Page/${mock.pages.size+1}`,handle:page.handle,title:page.title};
      mock.pages.set(page.handle,p);
      return json(res,200,{data:{pageCreate:{page:p,userErrors:[]}}});
    }
    if(query.includes('PaidUnfulfilledOrders')){
      const nodes=mock.productCreated&&mock.published?[{
        id:'gid://shopify/Order/5001',name:'#1001',createdAt:new Date().toISOString(),
        displayFinancialStatus:'PAID',displayFulfillmentStatus:'UNFULFILLED',email:'buyer@example.test',
        shippingAddress:{name:'QA Buyer',address1:'100 Test Ave',address2:null,city:'Detroit',province:'Michigan',
          provinceCode:'MI',zip:'48201',country:'United States',countryCodeV2:'US',phone:'+13135550199'},
        lineItems:{nodes:[{id:'gid://shopify/LineItem/1',name:'Car Diffuser',quantity:1,sku:'EOS-CAR_DIFFUSER',
          variant:{id:'gid://shopify/ProductVariant/2001',sku:'EOS-CAR_DIFFUSER',product:{id:'gid://shopify/Product/1001'}}}]}
      }]:[];
      return json(res,200,{data:{orders:{nodes}}});
    }
    return json(res,400,{errors:[{message:'Unhandled Shopify operation in QA mock'}]});
  }

  if(req.method==='GET'&&url.pathname==='/products/car-diffuser'){
    res.writeHead(mock.published?200:404,{'content-type':'text/html'});return res.end('<html><body>QA product</body></html>');
  }

  const cjPath=url.pathname.replace(/^\/api2\.0\/v1/,'');
  if(req.method==='POST'&&cjPath==='/authentication/getAccessToken'){
    return cj(res,{accessToken:'cj-access-test',accessTokenExpiryDate:'2099-01-01T00:00:00Z',
      refreshToken:'cj-refresh-test',refreshTokenExpiryDate:'2099-06-01T00:00:00Z',openId:'qa-open-id'});
  }
  if(req.method==='POST'&&cjPath==='/authentication/refreshAccessToken'){
    return cj(res,{accessToken:'cj-access-refreshed',accessTokenExpiryDate:'2099-01-01T00:00:00Z',
      refreshToken:'cj-refresh-test',refreshTokenExpiryDate:'2099-06-01T00:00:00Z'});
  }
  if(req.method==='GET'&&cjPath==='/product/listV2'){
    return cj(res,{content:[{productList:[{
      id:'CJ-PRODUCT-1',nameEn:'Car Diffuser',sku:'CJ-CD-1',bigImage:'https://example.test/car.jpg',
      sellPrice:'8.00',nowPrice:'8.00',listedNum:1234,totalVerifiedInventory:500,supplierName:'QA Supplier'
    }]}]});
  }
  if(req.method==='GET'&&cjPath==='/product/variant/query'){
    return cj(res,[{vid:'CJ-VARIANT-1',variantSku:'CJ-CD-V1',variantNameEn:'Black',variantSellPrice:8,variantImage:''}]);
  }
  if(req.method==='GET'&&cjPath==='/product/stock/queryByVid'){
    return cj(res,[{totalInventoryNum:500,countryCode:'CN',verifiedWarehouse:1,warehouseName:'QA Warehouse'}]);
  }
  if(req.method==='POST'&&cjPath==='/logistic/freightCalculate'){
    return cj(res,[{logisticName:'CJPacket Ordinary',logisticPrice:4.5,deliveryDay:'7-12'}]);
  }
  if(req.method==='POST'&&cjPath==='/shopping/order/createOrderV2'){
    mock.createOrderCalls++;
    const ext=String(body.orderNumber||'');
    mock.cjOrder={id:'CJ-ORDER-1',external:ext};
    return cj(res,'CJ-ORDER-1');
  }
  if(req.method==='GET'&&cjPath==='/shopping/order/getOrderDetail'){
    const id=url.searchParams.get('orderId')||'';
    if(!mock.cjOrder||![mock.cjOrder.id,mock.cjOrder.external].includes(id))return cjFail(res,'Order not found');
    return cj(res,{
      orderId:mock.cjOrder.id,orderNum:mock.cjOrder.external,cjOrderCode:'CJCODE-1',
      orderStatus:mock.cjPaid?'PROCESSING':'CREATED',orderAmount:12.5,productAmount:8,postageAmount:4.5,
      trackNumber:mock.cjPaid?'TRACK-QA-123':'',trackingUrl:mock.cjPaid?'https://tracking.example.test/TRACK-QA-123':'',
      trackingProvider:mock.cjPaid?'QA Carrier':''
    });
  }
  if(req.method==='GET'&&cjPath==='/shopping/pay/getBalance')return cj(res,{amount:1000});
  if(req.method==='POST'&&cjPath==='/shopping/pay/payBalanceV2'){
    if(!mock.cjOrder||body.shipmentOrderId!==mock.cjOrder.id)return cjFail(res,'Shipment order missing');
    mock.payCalls++; mock.cjPaid=true; return cj(res,{success:true});
  }
  return json(res,404,{error:'Unhandled QA mock route',method:req.method,path:url.pathname});
});

const children=[];
function start(command,args,env){
  const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>process.stdout.write('[child] '+d));
  child.stderr.on('data',d=>process.stderr.write('[child] '+d));
  children.push(child);return child;
}
function cleanup(){
  for(const child of children){try{child.kill('SIGTERM');}catch{}}
  try{server.close();}catch{}
}
process.on('exit',cleanup);process.on('SIGINT',()=>{cleanup();process.exit(130);});

function assert(condition,message){if(!condition)throw new Error('ASSERTION FAILED: '+message);}
async function waitFor(fn,label,timeout=30000,interval=250){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){
    try{const v=await fn();if(v)return v;}catch(e){last=e;}
    await new Promise(r=>setTimeout(r,interval));
  }
  throw new Error(`Timed out waiting for ${label}${last?': '+last.message:''}`);
}
async function api(path,opts={}){
  const res=await fetch(`http://127.0.0.1:${API_PORT}${path}`,opts);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.error||`HTTP ${res.status}`),{status:res.status,data});
  return data;
}

await new Promise(resolve=>server.listen(MOCK_PORT,'127.0.0.1',resolve));
const common={
  PORT:String(API_PORT),
  DATABASE_URL:process.env.DATABASE_URL,
  PGSSLMODE:'disable',
  JWT_SECRET:process.env.JWT_SECRET,
  CREDENTIALS_MASTER_KEY:process.env.CREDENTIALS_MASTER_KEY,
  PROVIDER_TEST_MODE:'1',
  SHOPIFY_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}`,
  CJ_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}/api2.0/v1`,
  COMMERCE_SYNC_INTERVAL_MS:'500'
};
const apiProc=start('node',['dist/api.js'],common);
await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`);return r.ok;},'API health');

const reg=await api('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:`commerce-${Date.now()}@example.test`,password:'Commerce-QA-Password-123!',companyName:'Commerce Sandbox QA'})});
const token=reg.token,company=reg.company.id;
const auth={'authorization':'Bearer '+token,'content-type':'application/json'};

await api(`/api/company/${company}/integrations/shopify/connect`,{method:'POST',headers:auth,
  body:JSON.stringify({storeDomain:'employee-os-qa.myshopify.com',accessToken:'shpat_qa_test_123456789'})});
await api(`/api/company/${company}/integrations/cj/connect`,{method:'POST',headers:auth,
  body:JSON.stringify({apiKey:'cj-api-key-qa-123456789'})});

const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const creds=await db.query('SELECT provider,ciphertext FROM integration_credentials WHERE company_id=$1 ORDER BY provider',[company]);
assert(creds.rowCount===2,'Shopify and CJ credentials should both be encrypted');
for(const row of creds.rows){
  assert(!String(row.ciphertext).includes('shpat_qa_test'),'Shopify token leaked into ciphertext text');
  assert(!String(row.ciphertext).includes('cj-api-key'),'CJ API key leaked into ciphertext text');
}

const member=await db.query('SELECT user_id FROM memberships WHERE company_id=$1',[company]);
const userId=member.rows[0].user_id;
const objective=await db.query(`INSERT INTO objectives(company_id,created_by,statement,constraints)
  VALUES($1,$2,'Build and publish the commerce QA venture','[]'::jsonb) RETURNING id`,[company,userId]);
const project=await db.query(`INSERT INTO projects(company_id,objective_id,name,phase,status)
  VALUES($1,$2,'Commerce Sandbox Venture','STORE_EXTERNAL_APPROVAL','ACTIVE') RETURNING id`,[company,objective.rows[0].id]);
const work=await db.query(`INSERT INTO work_orders(
  company_id,project_id,owner_employee_slug,assigned_employee_slug,objective,status,risk_level,success_criteria
) VALUES($1,$2,'ava','luca','Build and publish verified QA store','NEEDS_APPROVAL','MEDIUM',$3) RETURNING id`,[
  company,project.rows[0].id,JSON.stringify(['verified CJ supplier','Shopify product live','reachable product URL'])
]);
const candidate=await db.query(`INSERT INTO product_candidates(
  company_id,project_id,work_order_id,name,status,score,confidence,discovery_mode,demand_score,marketplace_seen,supplier_seen,
  observed_market_price,observed_source_price,observed_gross_margin_pct,contentability_score,risk_flags,creative_angles,analysis
) VALUES($1,$2,$3,'car diffuser','APPROVED',88,'HIGH','QA',90,true,true,39.99,8,79,90,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb)
RETURNING id`,[company,project.rows[0].id,work.rows[0].id]);
const packageR=await db.query(`INSERT INTO store_packages(
  company_id,project_id,work_order_id,candidate_id,status,brand_direction,offer,page_architecture,copy_draft,qa_result,external_state
) VALUES($1,$2,$3,$4,'READY_FOR_EXTERNAL',$5,$6,$7,$8,$9,$10) RETURNING id`,[
  company,project.rows[0].id,work.rows[0].id,candidate.rows[0].id,
  JSON.stringify({workingNameOptions:['DriveScent'],positioning:'Simple car scent upgrade'}),
  JSON.stringify({primaryOffer:'Car Diffuser',shipping:'verified only'}),
  JSON.stringify(Array.from({length:8},(_,i)=>({section:'Section '+(i+1),goal:'QA',content:['verified copy']}))),
  JSON.stringify({headline:'Refresh the drive.',subheadline:'A simple car diffuser.',cta:'Shop now',note:'Evidence-safe QA copy'}),
  JSON.stringify({passed:true,checks:['QA fixture']}),
  JSON.stringify({shopify:'CONNECTED',publishAllowed:false})
]);
const job=await db.query(`INSERT INTO jobs(
  company_id,project_id,work_order_id,employee_slug,job_type,payload,status,idempotency_key
) VALUES($1,$2,$3,'luca','STORE_BUILD',$4,'WAITING_APPROVAL',$5) RETURNING id`,[
  company,project.rows[0].id,work.rows[0].id,
  JSON.stringify({candidateId:candidate.rows[0].id,candidate:'car diffuser'}),
  `sandbox-store-build:${candidate.rows[0].id}`
]);
for(let i=0;i<5;i++){
  const step=['BRAND_STRATEGY','STORE_BRIEF','STORE_QA','EXTERNAL_HANDOFF','SHOPIFY_EXECUTE'][i];
  await db.query(`INSERT INTO job_steps(company_id,job_id,sequence,step_type,status,input,output)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[
    company,job.rows[0].id,i+1,step,i<4?'SUCCEEDED':'PENDING',
    JSON.stringify({candidateId:candidate.rows[0].id}),
    i<4?JSON.stringify({fixture:true}):null
  ]);
}
const approval=await db.query(`INSERT INTO approvals(
  company_id,project_id,work_order_id,job_id,requested_by_employee_slug,action_type,action_payload,
  reason,risk,cost_cents,status
) VALUES($1,$2,$3,$4,'luca','SHOPIFY_BUILD_AND_PUBLISH',$5,'QA publish approval','MEDIUM',0,'PENDING') RETURNING id`,[
  company,project.rows[0].id,work.rows[0].id,job.rows[0].id,
  JSON.stringify({packageId:packageR.rows[0].id,publish:true})
]);

await api(`/api/company/${company}/approvals/${approval.rows[0].id}/approve`,{method:'POST',headers:auth});
const worker=start('node',['dist/worker.js'],common);

const live=await waitFor(async()=>{
  const s=await api(`/api/company/${company}/state`,{headers:auth});
  return s.storePackages.find(p=>p.id===packageR.rows[0].id&&p.status==='LIVE')||null;
},'Shopify store live',45000);
assert(live.external_state.productUrl===`http://127.0.0.1:${MOCK_PORT}/products/car-diffuser`,'live product URL was not persisted');
assert(live.external_state.supplier?.provider==='CJ','CJ mapping not persisted with live store');
assert(mock.productSetCalls===1,'Shopify product should be created exactly once');
assert(mock.publishCalls===1,'Shopify product should be published exactly once');

const paymentApproval=await waitFor(async()=>{
  const s=await api(`/api/company/${company}/state`,{headers:auth});
  const f=s.fulfillmentOrders.find(x=>x.shopify_order_id==='gid://shopify/Order/5001');
  const a=s.approvals.find(x=>x.action_type==='CJ_ORDER_PAYMENT'&&x.status==='PENDING');
  return f&&f.status==='NEEDS_PAYMENT_APPROVAL'&&a?{f,a}:null;
},'CJ payment approval',30000);
assert(mock.createOrderCalls===1,'CJ supplier order should be created exactly once');
assert(mock.payCalls===0,'CJ must not be paid before owner approval');

await new Promise(r=>setTimeout(r,1200));
assert(mock.createOrderCalls===1,'repeated commerce polls created a duplicate CJ order');
await api(`/api/company/${company}/approvals/${paymentApproval.a.id}/approve`,{method:'POST',headers:auth});

const tracked=await waitFor(async()=>{
  const s=await api(`/api/company/${company}/state`,{headers:auth});
  return s.fulfillmentOrders.find(x=>x.shopify_order_id==='gid://shopify/Order/5001'&&x.tracking_number==='TRACK-QA-123')||null;
},'paid CJ order with tracking',30000);
assert(mock.payCalls===1,'CJ payment should execute exactly once after approval');
assert(tracked.supplier_order_id==='CJ-ORDER-1','CJ supplier order ID missing');
assert(tracked.tracking_url==='https://tracking.example.test/TRACK-QA-123','tracking URL missing');

const finalState=await api(`/api/company/${company}/state`,{headers:auth});
assert(finalState.fulfillmentOrders.filter(x=>x.shopify_order_id==='gid://shopify/Order/5001').length===1,
  'fulfillment idempotency failed');

console.log('COMMERCE SANDBOX QA PASSED');
console.log(JSON.stringify({
  productUrl:live.external_state.productUrl,
  supplier:live.external_state.supplier,
  fulfillmentStatus:tracked.status,
  trackingNumber:tracked.tracking_number,
  createOrderCalls:mock.createOrderCalls,
  payCalls:mock.payCalls,
  encryptedCredentialRows:creds.rowCount
},null,2));

await db.end();
cleanup();
process.exit(0);
