import http from 'node:http';
import assert from 'node:assert/strict';

const PORT=4380;
process.env.AYRSHARE_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.RESEND_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.PROVIDER_TEST_MODE='1';
process.env.RUNWAY_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.SHOPIFY_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;

const calls={email:0,social:0,runwayCreate:0,shopifyDraft:0};
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json'});res.end(body);}
const scopes=[
  'read_products','write_products','read_orders','read_publications','write_publications','read_content','write_content',
  'read_themes','write_themes','read_files','write_files','read_online_store_pages','write_online_store_pages',
  'read_merchant_managed_fulfillment_orders','write_merchant_managed_fulfillment_orders',
  'read_third_party_fulfillment_orders','write_third_party_fulfillment_orders'
];
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  const chunks=[];for await(const c of req)chunks.push(c);
  let body={};try{body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{}
  if(req.method==='GET'&&u.pathname==='/domains')return json(res,200,{data:[{id:'d',name:'example.test',status:'verified'}]});
  if(req.method==='POST'&&u.pathname==='/emails'){calls.email++;return json(res,200,{id:'hoodie-email-1'});}
  if(req.method==='GET'&&u.pathname==='/api/user')return json(res,200,{title:'Hoodies QA',activeSocialAccounts:['instagram','tiktok']});
  if(req.method==='POST'&&u.pathname==='/api/post'){calls.social++;return json(res,200,{status:'success',id:'hoodie-social-1',postIds:[
    {status:'success',platform:'instagram',id:'ig-hoodie'},{status:'success',platform:'tiktok',id:'tt-hoodie'}]});}
  if(req.method==='GET'&&u.pathname==='/v1/tasks/00000000-0000-0000-0000-000000000000')return json(res,404,{});
  if(req.method==='POST'&&u.pathname==='/v1/image_to_video'){calls.runwayCreate++;return json(res,200,{id:'hoodie-render-1'});}
  if(req.method==='GET'&&u.pathname==='/v1/tasks/hoodie-render-1')return json(res,200,{status:'SUCCEEDED',output:['https://cdn.example.test/hoodie.mp4']});
  if(req.method==='POST'&&u.pathname==='/admin/api/2026-07/graphql.json'){
    const q=String(body.query||'');
    if(q.includes('EmployeeOSConnectionCheck'))return json(res,200,{data:{
      shop:{name:'Hoodies QA Store',myshopifyDomain:'hoodies-qa.myshopify.com',currencyCode:'USD',primaryDomain:{url:'https://hoodies.example.test',host:'hoodies.example.test'}},
      publications:{nodes:[{id:'gid://shopify/Publication/1',catalog:{title:'Online Store',status:'ACTIVE'}}]},
      currentAppInstallation:{accessScopes:scopes.map(handle=>({handle}))}
    }});
    if(q.includes('EmployeeOSReleaseGateRead'))return json(res,200,{data:{shop:{name:'Hoodies QA Store',myshopifyDomain:'hoodies-qa.myshopify.com'},products:{nodes:[]}}});
    if(q.includes('EmployeeOSReleaseGateDraft')){calls.shopifyDraft++;return json(res,200,{data:{productSet:{product:{
      id:'gid://shopify/Product/hoodie-qa',handle:String(body.variables?.input?.handle),title:'Employee OS Release Gate QA — Safe Draft',status:'DRAFT'
    },userErrors:[]}}});}
    return json(res,400,{errors:[{message:'unhandled'}]});
  }
  return json(res,404,{error:'unhandled'});
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const {pool}=await import('../dist/db.js');
const {connectResend,connectAyrshare,sendSupportEmail,publishSocial}=await import('../dist/external-connections.js');
const {connectRunway,renderOriginalProductClips}=await import('../dist/runway-executor.js');
const {connectShopify,verifyShopifyDraftWrite}=await import('../dist/shopify-executor.js');

try{
  const company=(await pool.query("INSERT INTO companies(name) VALUES('Hoodies 4x4 QA') RETURNING id")).rows[0].id;
  await connectResend({companyId:company,apiKey:'hoodie-email-key-123',fromEmail:'support@example.test'});
  await connectAyrshare({companyId:company,apiKey:'hoodie-social-key-123'});
  await connectRunway({companyId:company,apiSecret:'hoodie-runway-key-123',model:'gen4.5'});
  await connectShopify({companyId:company,storeDomain:'hoodies-qa.myshopify.com',accessToken:'shpat_hoodie_qa_123456'});

  const support=await sendSupportEmail({companyId:company,jobId:null,workOrderId:null,employeeSlug:'ellis',idempotencyKey:'hoodies-email',
    to:'qa@example.test',subject:'Does this work with my setup?',text:'Hoodies support QA reply'});
  const creative=await renderOriginalProductClips({companyId:company,jobId:null,workOrderId:null,employeeSlug:'maya',idempotencyKey:'hoodies-render',
    promptImage:'https://cdn.example.test/hoodie.jpg',specs:[{id:'hoodie-clip',promptText:'Original hoodie launch clip'}],clipCount:1,duration:5});
  const social=await publishSocial({companyId:company,jobId:null,workOrderId:null,employeeSlug:'nova',idempotencyKey:'hoodies-social',
    post:'Hoodies launch QA',platforms:['instagram','tiktok'],mediaUrls:[creative[0].temporaryUrl],scheduleDate:'2099-01-01T18:00:00Z'});
  const store=await verifyShopifyDraftWrite(company);

  assert.equal(support.id,'hoodie-email-1');
  assert.equal(creative[0].taskId,'hoodie-render-1');
  assert.equal(social.id,'hoodie-social-1');
  assert.equal(store.draftProduct.status,'DRAFT');

  await sendSupportEmail({companyId:company,jobId:null,workOrderId:null,employeeSlug:'ellis',idempotencyKey:'hoodies-email',
    to:'qa@example.test',subject:'Does this work with my setup?',text:'Hoodies support QA reply'});
  await renderOriginalProductClips({companyId:company,jobId:null,workOrderId:null,employeeSlug:'maya',idempotencyKey:'hoodies-render',
    promptImage:'https://cdn.example.test/hoodie.jpg',specs:[{id:'hoodie-clip',promptText:'Original hoodie launch clip'}],clipCount:1,duration:5});
  await publishSocial({companyId:company,jobId:null,workOrderId:null,employeeSlug:'nova',idempotencyKey:'hoodies-social',
    post:'Hoodies launch QA',platforms:['instagram','tiktok'],mediaUrls:[creative[0].temporaryUrl],scheduleDate:'2099-01-01T18:00:00Z'});
  await verifyShopifyDraftWrite(company);

  assert.deepEqual(calls,{email:1,social:1,runwayCreate:1,shopifyDraft:1});
  const ledger=await pool.query("SELECT provider,status,attempt_count,provider_external_id FROM external_actions WHERE company_id=$1 ORDER BY provider",[company]);
  assert.equal(ledger.rowCount,4);
  assert(ledger.rows.every(r=>r.status==='SUCCEEDED'));
  assert(ledger.rows.every(r=>Number(r.attempt_count)===1));
  assert(ledger.rows.every(r=>String(r.provider_external_id||'').length>0));

  console.log('HOODIES 4/4 RELEASE-GATE SANDBOX PASSED');
  console.log(JSON.stringify({workflowsPassed:4,total:4,duplicates:0,auditedActions:ledger.rowCount,calls},null,2));
}finally{
  await pool.end();await new Promise(r=>server.close(r));
}
