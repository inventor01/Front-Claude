import http from 'node:http';
import {spawn} from 'node:child_process';
import pg from 'pg';
const {Pool}=pg;

const MOCK_PORT=4320;
const API_PORT=4330;
const REEL='https://www.instagram.com/reel/DdzMnipOcwJ/?stkn=MXczbXJpcXQ1NTBrYg==';
const mock={
  productCreated:false,published:false,themePublished:false,
  productSetCalls:0,publishCalls:0,themeDuplicateCalls:0,themeWriteCalls:0,themePublishCalls:0,
  pages:new Map()
};

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
  res.end(body);
}
function text(res,status,payload){
  res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(payload);
}
function cj(res,data,message='Success'){json(res,200,{code:200,result:true,message,data,requestId:'qa'});}

const shopifyScopes=[
  'read_products','write_products','read_orders','read_publications','write_publications',
  'read_content','write_content','read_themes','write_themes','read_online_store_pages','write_online_store_pages',
  'read_merchant_managed_fulfillment_orders','write_merchant_managed_fulfillment_orders',
  'read_third_party_fulfillment_orders','write_third_party_fulfillment_orders'
];

const analysis={
  product:{
    name:'Smart Waterless Car Diffuser',
    searchQuery:'car diffuser',
    description:'Compact car fragrance diffuser demonstrated inside a vehicle.',
    visibleFeatures:['compact body','car placement','mist-free fragrance use'],
    confidence:'HIGH',
    uncertainty:['Exact internal fragrance mechanism is not visible from the reference.']
  },
  audience:{signals:['drivers','car interior enthusiasts'],likelyUseCases:['daily commute','vehicle scent refresh']},
  creative:{
    hook:'Immediate close-up demonstration inside the car',
    shotPattern:['product close-up','placement in vehicle','use demonstration','result/reaction','CTA'],
    pacing:'fast 1-3 second social-commerce cuts',
    cameraStyle:['handheld close-up','tight product framing'],
    textOverlayStyle:'short bold benefit phrases',
    audioRole:'rhythmic pacing support; no source audio should be copied',
    cta:'show the product result then direct viewers to product details',
    visualStyle:['dark car interior','high contrast product close-up','clean premium gadget framing'],
    palette:['#101114','#f5f2ea','#ff6b35'],
    typographyMood:'bold condensed modern sans-serif',
    layoutMood:'premium automotive gadget, dark contrast, product-led',
    doNotCopy:['creator identity','exact script','source music','exact text overlays','original footage'],
    originalVariationDirections:['new dashboard angle','night-drive variation','unboxing-to-install variation']
  },
  source:{captionSignals:['car accessory demo','product-focused'],engagementSignal:'Reference supplied by owner; performance metrics are contextual only.'}
};

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${MOCK_PORT}`);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString('utf8');
  let body={};try{body=raw?JSON.parse(raw):{};}catch{}

  if(req.method==='GET'&&url.pathname.startsWith('/v2/acts/apify~instagram-api-scraper')){
    return json(res,200,{data:{id:'actor-instagram',name:'instagram-api-scraper'}});
  }
  if(req.method==='POST'&&url.pathname.includes('/run-sync-get-dataset-items')){
    return json(res,200,[{
      ownerUsername:'qa-creator',caption:'A compact car diffuser demo for a cleaner premium interior setup.',
      displayUrl:`http://127.0.0.1:${MOCK_PORT}/reference.jpg`,
      likesCount:12500,commentsCount:410,videoViewCount:250000,timestamp:'2026-09-28T12:00:00Z'
    }]);
  }
  if(req.method==='GET'&&url.pathname==='/v1/models'){
    return json(res,200,{data:[{id:'gpt-5.6-luna'}]});
  }
  if(req.method==='POST'&&url.pathname==='/v1/responses'){
    return json(res,200,{id:'resp-link-qa',output_text:JSON.stringify(analysis)});
  }

  if(req.method==='GET'&&url.pathname==='/research/shopify-trends'){
    return text(res,200,'## What products are trending right now?\n1. **Car diffusers:** vehicle fragrance accessories continue to draw buyer interest.\n');
  }
  if(req.method==='GET'&&url.pathname==='/research/amazon'){
    return text(res,200,'Car diffuser smart vehicle fragrance accessory $39.99 Bestseller car diffuser $42.00');
  }
  if(req.method==='GET'&&url.pathname==='/research/aliexpress'){
    return text(res,200,'Car diffuser vehicle fragrance accessory supplier listing $8.00 $9.00');
  }

  if(req.method==='POST'&&url.pathname==='/admin/api/2026-07/graphql.json'){
    const query=String(body.query||'');
    if(query.includes('EmployeeOSConnectionCheck')){
      return json(res,200,{data:{
        shop:{name:'Link Launch QA Store',myshopifyDomain:'link-launch-qa.myshopify.com',currencyCode:'USD',
          primaryDomain:{url:`http://127.0.0.1:${MOCK_PORT}`,host:'127.0.0.1'}},
        publications:{nodes:[{id:'gid://shopify/Publication/1',catalog:{title:'Online Store',status:'ACTIVE'}}]},
        currentAppInstallation:{accessScopes:shopifyScopes.map(handle=>({handle}))}
      }});
    }
    if(query.includes('BuildProduct')){
      mock.productSetCalls++;mock.productCreated=true;
      return json(res,200,{data:{productSet:{product:{
        id:'gid://shopify/Product/1001',handle:'car-diffuser',title:'Car Diffuser',status:'ACTIVE',
        variants:{nodes:[{id:'gid://shopify/ProductVariant/2001',price:'39.99'}]}
      },userErrors:[]}}});
    }
    if(query.includes('PublishProduct')){
      mock.publishCalls++;mock.published=true;
      return json(res,200,{data:{publishablePublish:{publishable:{publishedOnPublication:true},userErrors:[]}}});
    }
    if(query.includes('ExistingPages')){
      const handle=String(body.variables?.query||'').replace(/^handle:/,'');
      const p=mock.pages.get(handle);return json(res,200,{data:{pages:{nodes:p?[p]:[]}}});
    }
    if(query.includes('CreatePage')){
      const page=body.variables?.page||{};const p={id:`gid://shopify/Page/${mock.pages.size+1}`,handle:page.handle,title:page.title};
      mock.pages.set(page.handle,p);return json(res,200,{data:{pageCreate:{page:p,userErrors:[]}}});
    }
    if(query.includes('MainTheme')){
      return json(res,200,{data:{themes:{nodes:[{id:'gid://shopify/OnlineStoreTheme/9001',name:'QA Main',role:'MAIN',processing:false}]}}});
    }
    if(query.includes('DuplicateTheme')){
      mock.themeDuplicateCalls++;return json(res,200,{data:{themeDuplicate:{newTheme:{id:'gid://shopify/OnlineStoreTheme/9002',name:'Employee OS QA',role:'UNPUBLISHED',processing:false},userErrors:[]}}});
    }
    if(query.includes('ThemeReady')){
      return json(res,200,{data:{theme:{id:'gid://shopify/OnlineStoreTheme/9002',name:'Employee OS QA',role:'UNPUBLISHED',processing:false}}});
    }
    if(query.includes('WriteVentureTheme')){
      mock.themeWriteCalls++;
      const files=Array.isArray(body.variables?.files)?body.variables.files:[];
      if(files.length<5)return json(res,200,{data:{themeFilesUpsert:{job:null,userErrors:[{filename:'templates/index.json',message:'Incomplete theme'}]}}});
      return json(res,200,{data:{themeFilesUpsert:{job:{id:'gid://shopify/Job/9100',done:true},userErrors:[]}}});
    }
    if(query.includes('ThemeFileJob'))return json(res,200,{data:{job:{id:'gid://shopify/Job/9100',done:true}}});
    if(query.includes('PublishVentureTheme')){
      mock.themePublishCalls++;mock.themePublished=true;
      return json(res,200,{data:{themePublish:{theme:{id:'gid://shopify/OnlineStoreTheme/9002',name:'Employee OS QA',role:'MAIN'},userErrors:[]}}});
    }
    if(query.includes('PaidUnfulfilledOrders'))return json(res,200,{data:{orders:{nodes:[]}}});
    return json(res,400,{errors:[{message:'Unhandled Shopify operation'}]});
  }

  if(req.method==='GET'&&url.pathname==='/products/car-diffuser'){
    res.writeHead(mock.published?200:404,{'content-type':'text/html'});return res.end('<html><body>Link QA product</body></html>');
  }
  if(req.method==='GET'&&url.pathname==='/'){
    res.writeHead(mock.themePublished?200:404,{'content-type':'text/html'});return res.end('<html><body>Link QA home</body></html>');
  }
  if(req.method==='GET'&&url.pathname==='/reference.jpg'){
    res.writeHead(200,{'content-type':'image/jpeg'});return res.end(Buffer.from([0xff,0xd8,0xff,0xd9]));
  }

  const cjPath=url.pathname.replace(/^\/api2\.0\/v1/,'');
  if(req.method==='POST'&&cjPath==='/authentication/getAccessToken'){
    return cj(res,{accessToken:'cj-access-test',accessTokenExpiryDate:'2099-01-01T00:00:00Z',refreshToken:'cj-refresh-test',refreshTokenExpiryDate:'2099-06-01T00:00:00Z',openId:'qa-open-id'});
  }
  if(req.method==='GET'&&cjPath==='/product/listV2'){
    return cj(res,{content:[{productList:[
      {id:'CJ-PRODUCT-1',nameEn:'Car Diffuser Premium',sku:'CJ-CD-1',bigImage:'https://example.test/car-premium.jpg',sellPrice:'7.00',nowPrice:'7.00',listedNum:1800,totalVerifiedInventory:500,supplierName:'QA Supplier A'},
      {id:'CJ-PRODUCT-2',nameEn:'Car Diffuser Smart',sku:'CJ-CD-2',bigImage:'https://example.test/car-smart.jpg',sellPrice:'9.00',nowPrice:'9.00',listedNum:1500,totalVerifiedInventory:320,supplierName:'QA Supplier B'}
    ]}]});
  }
  if(req.method==='GET'&&cjPath==='/product/variant/query'){
    const pid=url.searchParams.get('pid');
    if(pid==='CJ-PRODUCT-1')return cj(res,[{vid:'CJ-VARIANT-1',variantSku:'CJ-CD-V1',variantNameEn:'Black',variantSellPrice:7,variantImage:'https://example.test/a.jpg'}]);
    return cj(res,[{vid:'CJ-VARIANT-2',variantSku:'CJ-CD-V2',variantNameEn:'Black',variantSellPrice:9,variantImage:'https://example.test/b.jpg'}]);
  }
  if(req.method==='GET'&&cjPath==='/product/variant/queryByVid'){
    const vid=url.searchParams.get('vid');const second=vid==='CJ-VARIANT-2';
    return cj(res,{vid,pid:second?'CJ-PRODUCT-2':'CJ-PRODUCT-1',variantSku:second?'CJ-CD-V2':'CJ-CD-V1',variantNameEn:'Black',
      variantSellPrice:second?9:7,inventories:[{countryCode:'CN',totalInventory:second?320:500,cjInventory:100,factoryInventory:second?220:400,verifiedWarehouse:1}]});
  }
  if(req.method==='GET'&&cjPath==='/product/stock/queryByVid'){
    const second=url.searchParams.get('vid')==='CJ-VARIANT-2';
    return cj(res,[{totalInventoryNum:second?320:500,countryCode:'CN',verifiedWarehouse:1,warehouseName:'QA Warehouse'}]);
  }
  if(req.method==='POST'&&cjPath==='/logistic/freightCalculate'){
    const vid=body?.products?.[0]?.vid;
    if(vid==='CJ-VARIANT-1')return cj(res,[{logisticName:'Slow Economy',logisticPrice:8,logisticAging:'12-18'}]);
    return cj(res,[{logisticName:'Fast Packet',logisticPrice:3,logisticAging:'5-8'}]);
  }
  return json(res,404,{error:'Unhandled QA mock route',method:req.method,path:url.pathname});
});

const children=[];
function start(command,args,env){
  const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>process.stdout.write('[child] '+d));child.stderr.on('data',d=>process.stderr.write('[child] '+d));
  children.push(child);return child;
}
function cleanup(){for(const child of children){try{child.kill('SIGTERM');}catch{}}try{server.close();}catch{}}
process.on('exit',cleanup);process.on('SIGINT',()=>{cleanup();process.exit(130);});
function assert(condition,message){if(!condition)throw new Error('ASSERTION FAILED: '+message);}
async function waitFor(fn,label,timeout=60000,interval=400){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await new Promise(r=>setTimeout(r,interval));}
  throw new Error(`Timed out waiting for ${label}${last?': '+last.message:''}`);
}
async function api(path,opts={}){
  const headers={...(opts.headers||{})};if(opts.body==null)delete headers['content-type'];else if(!headers['content-type'])headers['content-type']='application/json';
  const response=await fetch(`http://127.0.0.1:${API_PORT}${path}`,{...opts,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,data});
  return data;
}

await new Promise(resolve=>server.listen(MOCK_PORT,'127.0.0.1',resolve));
const common={
  PORT:String(API_PORT),DATABASE_URL:process.env.DATABASE_URL,PGSSLMODE:'disable',JWT_SECRET:process.env.JWT_SECRET,
  CREDENTIALS_MASTER_KEY:process.env.CREDENTIALS_MASTER_KEY,PROVIDER_TEST_MODE:'1',
  SHOPIFY_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}`,
  CJ_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}/api2.0/v1`,
  APIFY_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}`,
  OPENAI_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}`,
  RESEARCH_TEST_BASE_URL:`http://127.0.0.1:${MOCK_PORT}`,
  COMMERCE_SYNC_INTERVAL_MS:'500'
};
start('node',['dist/api.js'],common);
await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`);return r.ok;},'API health');

const reg=await api('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  email:`link-${Date.now()}@example.test`,password:'Link-Launch-QA-Password-123!',companyName:'Link Launch QA'
})});
const token=reg.token,company=reg.company.id;const auth={'authorization':'Bearer '+token,'content-type':'application/json'};
await api(`/api/company/${company}/integrations/apify/connect`,{method:'POST',headers:auth,body:JSON.stringify({token:'apify-qa-token-123456789'})});
await api(`/api/company/${company}/integrations/openai/connect`,{method:'POST',headers:auth,body:JSON.stringify({apiKey:'sk-qa-openai-key-123456789'})});
await api(`/api/company/${company}/integrations/shopify/connect`,{method:'POST',headers:auth,body:JSON.stringify({storeDomain:'link-launch-qa.myshopify.com',accessToken:'shpat_link_qa_123456789'})});
await api(`/api/company/${company}/integrations/cj/connect`,{method:'POST',headers:auth,body:JSON.stringify({apiKey:'cj-link-qa-key-123456789'})});

const launch=await api(`/api/company/${company}/ventures/from-link`,{method:'POST',headers:auth,body:JSON.stringify({url:REEL,constraints:['Prefer strongest landed-cost/shipping tradeoff'],budgetCents:30000})});
const project=launch.project.id;
start('node',['dist/worker.js'],common);

const productGate=await waitFor(async()=>{
  const state=await api(`/api/company/${company}/state`,{headers:auth});
  const candidate=state.productCandidates.find(x=>x.project_id===project);
  const approval=state.approvals.find(x=>x.project_id===project&&x.action_type==='PRODUCT_GATE'&&x.status==='PENDING');
  const source=state.referenceSources.find(x=>x.project_id===project);
  return candidate&&approval&&source?.status==='ANALYZED'?{state,candidate,approval,source}:null;
},'reference analysis and Product Gate',80000);

assert(productGate.source.source_url===REEL,'original Reel provenance was not preserved');
assert(productGate.source.analysis.product.searchQuery==='car diffuser','vision product identification was not persisted');
assert(productGate.source.creative_reference.palette[2]==='#ff6b35','creative visual system was not persisted');
assert(productGate.candidate.discovery_mode==='SOCIAL_REFERENCE','candidate did not retain social-reference discovery mode');
assert(productGate.candidate.name==='car diffuser','candidate did not use supplier-friendly identified query');

await api(`/api/company/${company}/approvals/${productGate.approval.id}/approve`,{method:'POST',headers:auth});

const publishGate=await waitFor(async()=>{
  const state=await api(`/api/company/${company}/state`,{headers:auth});
  const approval=state.approvals.find(x=>x.project_id===project&&x.action_type==='SHOPIFY_BUILD_AND_PUBLISH'&&x.status==='PENDING');
  const creative=state.creativePackages.find(x=>x.project_id===project);
  return approval&&creative?{state,approval,creative}:null;
},'Luca publish approval and Maya handoff',80000);

assert(publishGate.creative.strategy.referenceSourceUrl===REEL,'Maya did not inherit reference source URL');
assert(publishGate.creative.strategy.referenceCreative.hook===analysis.creative.hook,'Maya did not inherit creative structure');
assert(publishGate.creative.strategy.referenceCreative.doNotCopy.includes('exact script'),'creative anti-copy guardrail was lost');

await api(`/api/company/${company}/approvals/${publishGate.approval.id}/approve`,{method:'POST',headers:auth});

const live=await waitFor(async()=>{
  const state=await api(`/api/company/${company}/state`,{headers:auth});
  const store=state.storePackages.find(x=>x.project_id===project&&x.status==='LIVE');
  const link=state.linkLaunches.find(x=>x.project_id===project&&x.status==='STORE_LIVE');
  const mapping=state.supplierMappings.find(x=>x.candidate_id===productGate.candidate.id);
  return store&&link&&mapping?{state,store,link,mapping}:null;
},'designed Link-to-Launch store live',100000);

assert(live.link.store_url===`http://127.0.0.1:${MOCK_PORT}`,'store URL not persisted on link launch');
assert(live.link.product_url===`http://127.0.0.1:${MOCK_PORT}/products/car-diffuser`,'product URL not persisted on link launch');
assert(live.store.external_state.theme?.themeId==='gid://shopify/OnlineStoreTheme/9002','theme publication result missing');
assert(live.store.external_state.homepageReachable===true,'homepage did not pass QA');
assert(live.mapping.supplier_product_id==='CJ-PRODUCT-2','offer ranker did not choose better landed-cost/shipping tradeoff');
assert(Number(live.mapping.landed_cost_estimate)===12,'winning landed cost was not persisted');
assert(live.mapping.stock_detail.deliveryMaxDays===8,'winning delivery window was not persisted');
assert(live.mapping.stock_detail.verifiedInventory===320,'verified available quantity was not persisted');
assert(mock.productSetCalls===1&&mock.publishCalls===1,'Shopify product lifecycle was not idempotent');
assert(mock.themeDuplicateCalls===1&&mock.themeWriteCalls===1&&mock.themePublishCalls===1,'full theme lifecycle did not execute exactly once');

const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const creds=await db.query('SELECT provider,ciphertext FROM integration_credentials WHERE company_id=$1 ORDER BY provider',[company]);
assert(creds.rowCount===4,'all four external provider credentials should be encrypted');
for(const row of creds.rows){
  const ciphertext=String(row.ciphertext);
  assert(!ciphertext.includes('apify-qa-token')&&!ciphertext.includes('openai-key')&&!ciphertext.includes('shpat_link')&&!ciphertext.includes('cj-link'),'credential plaintext leaked into encrypted storage');
}
await db.end();

console.log('LINK-TO-LAUNCH SANDBOX QA PASSED');
console.log(JSON.stringify({
  source:REEL,identifiedProduct:productGate.candidate.name,confidence:productGate.candidate.confidence,
  supplierProduct:live.mapping.supplier_product_id,landedCost:Number(live.mapping.landed_cost_estimate),
  deliveryMaxDays:live.mapping.stock_detail.deliveryMaxDays,verifiedQuantity:live.mapping.stock_detail.verifiedInventory,
  storeUrl:live.link.store_url,productUrl:live.link.product_url,themeId:live.store.external_state.theme.themeId,
  referenceCreativeInherited:true
},null,2));
cleanup();process.exit(0);
