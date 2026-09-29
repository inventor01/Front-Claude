import { pool } from './db.js';
import { readCredential,storeCredential,deleteCredential } from './credentials.js';
import { mapCandidateToCJ,requireVerifiedCJMapping } from './cj-executor.js';
import { buildAndPublishTheme } from './theme-executor.js';

const API_VERSION='2026-07';
const PROVIDER_TEST_MODE=process.env.PROVIDER_TEST_MODE==='1';
const SHOPIFY_TEST_BASE=PROVIDER_TEST_MODE?String(process.env.SHOPIFY_TEST_BASE_URL||'').replace(/\/$/,''):'';

type ShopifyCredential={storeDomain:string;accessToken:string};

type GraphQLResponse<T>={
  data?:T;
  errors?:Array<{message:string;extensions?:Record<string,unknown>}>;
};

function normalizeStoreDomain(value:string){
  const trimmed=value.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const host=trimmed.split('/')[0]||'';
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)){
    throw new Error('Use the permanent .myshopify.com store domain, for example your-store.myshopify.com.');
  }
  return host;
}

async function graph<T>(credential:ShopifyCredential,query:string,variables:Record<string,unknown>={}):Promise<T>{
  const endpoint=SHOPIFY_TEST_BASE?`${SHOPIFY_TEST_BASE}/admin/api/${API_VERSION}/graphql.json`:`https://${credential.storeDomain}/admin/api/${API_VERSION}/graphql.json`;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-shopify-access-token':credential.accessToken,
      'user-agent':'AI-Employee-OS/0.4'
    },
    body:JSON.stringify({query,variables})
  });
  const text=await response.text();
  if(!response.ok)throw new Error(`Shopify HTTP ${response.status}: ${text.slice(0,800)}`);
  let parsed:GraphQLResponse<T>;
  try{parsed=JSON.parse(text) as GraphQLResponse<T>;}catch{throw new Error('Shopify returned invalid JSON.');}
  if(parsed.errors?.length)throw new Error(`Shopify GraphQL: ${parsed.errors.map((e)=>e.message).join('; ')}`);
  if(!parsed.data)throw new Error('Shopify GraphQL returned no data.');
  return parsed.data;
}

function userErrors(value:unknown){
  if(!value||typeof value!=='object')return [];
  const errors=(value as {userErrors?:unknown}).userErrors;
  return Array.isArray(errors)?errors:[];
}

export async function connectShopify(input:{companyId:string;storeDomain:string;accessToken:string}){
  const storeDomain=normalizeStoreDomain(input.storeDomain);
  const credential={storeDomain,accessToken:input.accessToken.trim()};
  const data=await graph<{
    shop:{name:string;myshopifyDomain:string;currencyCode:string;primaryDomain:{url:string;host:string}};
    publications:{nodes:Array<{id:string;catalog:{title:string;status:string}|null}>};
    currentAppInstallation:{accessScopes:Array<{handle:string}>};
  }>(credential,`query EmployeeOSConnectionCheck {
    shop { name myshopifyDomain currencyCode primaryDomain { url host } }
    publications(first: 30) { nodes { id catalog { title status } } }
    currentAppInstallation { accessScopes { handle } }
  }`);

  const granted=new Set(data.currentAppInstallation.accessScopes.map((scope)=>scope.handle));
  const required=['read_products','write_products','read_orders','read_publications','write_publications','read_content','write_content','read_themes','write_themes','read_files','write_files','read_online_store_pages','write_online_store_pages','read_merchant_managed_fulfillment_orders','write_merchant_managed_fulfillment_orders','read_third_party_fulfillment_orders','write_third_party_fulfillment_orders'];
  const missing=required.filter((scope)=>!granted.has(scope));
  if(missing.length){
    throw new Error(`Shopify connection is missing required scopes: ${missing.join(', ')}`);
  }

  const online=data.publications.nodes.find((p)=>String(p.catalog?.title||'').toLowerCase().includes('online store'))||null;
  if(!online)throw new Error('Connected Shopify store does not expose an Online Store publication to this app token.');

  const existing=await pool.query(`SELECT * FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' ORDER BY updated_at DESC LIMIT 1`,[input.companyId]);
  let connection;
  const metadata={
    storeName:data.shop.name,
    storeDomain:data.shop.myshopifyDomain,
    primaryDomain:data.shop.primaryDomain,
    currencyCode:data.shop.currencyCode,
    publicationId:online.id,
    publicationTitle:online.catalog?.title||'Online Store',
    apiVersion:API_VERSION,
    grantedScopes:[...granted].sort(),
    connectedAt:new Date().toISOString()
  };
  if(existing.rowCount){
    const r=await pool.query(`UPDATE tool_connections SET tool_id='shopify-admin',risk_class='HIGH',
      status='CONNECTED',metadata=$2,updated_at=now() WHERE id=$1 RETURNING *`,[
      existing.rows[0].id,JSON.stringify(metadata)
    ]);
    connection=r.rows[0];
  }else{
    const r=await pool.query(`INSERT INTO tool_connections(company_id,tool_id,provider,risk_class,status,metadata)
      VALUES($1,'shopify-admin','SHOPIFY','HIGH','CONNECTED',$2) RETURNING *`,[
      input.companyId,JSON.stringify(metadata)
    ]);
    connection=r.rows[0];
  }
  await storeCredential({companyId:input.companyId,provider:'SHOPIFY',connectionId:connection.id,secret:credential});
  return {connection,shop:data.shop,onlineStorePublication:{id:online.id,title:online.catalog?.title||'Online Store'}};
}

export async function disconnectShopify(companyId:string){
  const r=await pool.query(`SELECT id FROM tool_connections WHERE company_id=$1 AND provider='SHOPIFY' ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {disconnected:false};
  const id=String(r.rows[0].id);
  await deleteCredential(companyId,'SHOPIFY',id);
  await pool.query(`UPDATE tool_connections SET status='DISCONNECTED',metadata=jsonb_set(metadata,'{disconnectedAt}',to_jsonb(now()::text),true),updated_at=now() WHERE id=$1`,[id]);
  return {disconnected:true};
}

export async function shopifyStatus(companyId:string){
  const r=await pool.query(`SELECT id,status,metadata,updated_at FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {connected:false,status:'NOT_CONNECTED'};
  const row=r.rows[0];
  return {connected:row.status==='CONNECTED',status:row.status,metadata:row.metadata,updatedAt:row.updated_at};
}

function slugify(value:string){
  const slug=value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
  return slug||`product-${Date.now()}`;
}

function descriptionHtml(candidate:Record<string,unknown>,pkg:Record<string,unknown>){
  const copy=(pkg.copy_draft&&typeof pkg.copy_draft==='object')?pkg.copy_draft as Record<string,unknown>:{};
  const architecture=Array.isArray(pkg.page_architecture)?pkg.page_architecture:[];
  const benefits=[
    'Designed around a clear, demonstrated use case.',
    'Simple setup and everyday use.',
    'Product details and expectations presented without unsupported claims.'
  ];
  return [
    `<h2>${String(copy.headline||candidate.name||'Product')}</h2>`,
    `<p>${String(copy.subheadline||'See the product use case clearly before deciding whether it fits your needs.')}</p>`,
    '<h3>Why it stands out</h3>',
    '<ul>'+benefits.map((x)=>`<li>${x}</li>`).join('')+'</ul>',
    '<h3>How to use it</h3><p>Follow the included product instructions and verify compatibility with your intended setup before use.</p>',
    '<h3>Shipping & returns</h3><p>Shipping estimates and return eligibility are shown according to the store policy and connected fulfillment source. We do not invent delivery windows.</p>',
    architecture.length?`<p><small>Store package includes ${architecture.length} conversion-focused sections.</small></p>`:''
  ].join('');
}

function safePrice(candidate:Record<string,unknown>){
  const market=Number(candidate.observed_market_price||0);
  const source=Number(candidate.observed_source_price||0);
  const margin=Number(candidate.observed_gross_margin_pct||0);
  if(!(market>0&&source>0&&market>source&&margin>0)){
    throw new Error('BLOCKED_UNVERIFIED_ECONOMICS: Verified market/source pricing is required before Shopify publication.');
  }
  return market.toFixed(2);
}

async function ensurePage(credential:ShopifyCredential,title:string,handle:string,body:string){
  const pages=await graph<{pages:{nodes:Array<{id:string;handle:string;title:string}>}}>(credential,
    `query ExistingPages($query:String!){ pages(first:10,query:$query){nodes{id handle title}} }`,{query:`handle:${handle}`});
  if(pages.pages.nodes.some((p)=>p.handle===handle))return pages.pages.nodes.find((p)=>p.handle===handle)!;
  const created=await graph<{pageCreate:{page:{id:string;handle:string;title:string}|null;userErrors:Array<{field:string[];message:string}>}}>(credential,
    `mutation CreatePage($page:PageCreateInput!){
      pageCreate(page:$page){page{id handle title} userErrors{field message}}
    }`,{page:{title,handle,body,isPublished:true}});
  if(userErrors(created.pageCreate).length)throw new Error(`Shopify page error: ${created.pageCreate.userErrors.map((e)=>e.message).join('; ')}`);
  if(!created.pageCreate.page)throw new Error('Shopify did not return the created page.');
  return created.pageCreate.page;
}

export async function executeStorePackage(input:{
  companyId:string;projectId:string;packageId:string;candidateId:string;
}){
  const connectionR=await pool.query(`SELECT * FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[input.companyId]);
  if(!connectionR.rowCount)throw new Error('BLOCKED_EXTERNAL_AUTH: Shopify store execution is not connected');
  const connection=connectionR.rows[0];
  const credential=await readCredential<ShopifyCredential>(input.companyId,'SHOPIFY',String(connection.id));

  const [pkgR,candidateR]=await Promise.all([
    pool.query('SELECT * FROM store_packages WHERE id=$1 AND company_id=$2 AND project_id=$3',[input.packageId,input.companyId,input.projectId]),
    pool.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2 AND project_id=$3',[input.candidateId,input.companyId,input.projectId])
  ]);
  if(!pkgR.rowCount||!candidateR.rowCount)throw new Error('Store package or candidate missing for Shopify execution.');
  const pkg=pkgR.rows[0],candidate=candidateR.rows[0];
  if(pkg.qa_result?.passed!==true)throw new Error('Store package must pass internal QA before Shopify execution.');

  let mapping;
  try{
    mapping=await requireVerifiedCJMapping(input.companyId,input.candidateId);
  }catch(error){
    const message=error instanceof Error?error.message:'CJ supplier mapping missing';
    if(!message.startsWith('BLOCKED_FULFILLMENT:'))throw error;
    const mapped=await mapCandidateToCJ(input.companyId,input.candidateId);
    if(mapped.status==='NEEDS_REVIEW'){
      throw new Error(`BLOCKED_SUPPLIER_MAPPING_REVIEW: CJ returned multiple plausible supplier matches. Review is required before publication.`);
    }
    mapping=await requireVerifiedCJMapping(input.companyId,input.candidateId);
  }

  const landedCost=Number(mapping.landed_cost_estimate||0);
  const marketPrice=Number(candidate.observed_market_price||0);
  if(!(landedCost>0&&marketPrice>landedCost)){
    throw new Error('BLOCKED_UNVERIFIED_ECONOMICS: Verified landed cost must be below observed market price before publication.');
  }
  const price=safePrice({...candidate,observed_source_price:Number(mapping.source_price||candidate.observed_source_price),
    observed_gross_margin_pct:((marketPrice-landedCost)/marketPrice)*100});
  const handle=slugify(String(candidate.name));
  const title=String(candidate.name).replace(/\b\w/g,(m)=>m.toUpperCase()).slice(0,255);
  const description=descriptionHtml(candidate,pkg);

  const productData=await graph<{productSet:{
    product:{id:string;handle:string;title:string;status:string;variants:{nodes:Array<{id:string;price:string}>}}|null;
    userErrors:Array<{field:string[];message:string}>;
  }}>(credential,`mutation BuildProduct($input:ProductSetInput!){
    productSet(synchronous:true,input:$input){
      product{id handle title status variants(first:5){nodes{id price}}}
      userErrors{field message}
    }
  }`,{input:{
    title,
    handle,
    descriptionHtml:description,
    productType:'Dropshipping Product',
    vendor:'Employee OS Venture',
    status:'ACTIVE',
    tags:['employee-os-venture','verified-research','organic-commerce'],
    seo:{title:`${title} | Shop`.slice(0,70),description:`Shop ${title}. Product details and claims are based on the current verified store package.`.slice(0,300)},
    productOptions:[{name:'Title',position:1,values:[{name:'Default Title'}]}],
    files:(()=>{
      const stock=(mapping.stock_detail&&typeof mapping.stock_detail==='object')?mapping.stock_detail as Record<string,unknown>:{};
      const image=String(stock.variantImage||stock.productImage||'');
      return /^https:\/\//i.test(image)?[{originalSource:image,contentType:'IMAGE',alt:title,duplicateResolutionMode:'APPEND_UUID'}]:[];
    })(),
    variants:[{
      optionValues:[{optionName:'Title',name:'Default Title'}],
      price,
      sku:`EOS-${handle.toUpperCase().replace(/-/g,'_').slice(0,40)}`,
      inventoryPolicy:'CONTINUE',
      inventoryItem:{tracked:false},
      requiresShipping:true,
      taxable:true
    }]
  }});
  if(productData.productSet.userErrors.length)throw new Error(`Shopify product error: ${productData.productSet.userErrors.map((e)=>e.message).join('; ')}`);
  if(!productData.productSet.product)throw new Error('Shopify did not return the created product.');
  const product=productData.productSet.product;

  const publicationId=String(connection.metadata?.publicationId||'');
  if(!publicationId)throw new Error('Shopify Online Store publication ID is missing from the connection.');
  const published=await graph<{publishablePublish:{publishable:{publishedOnPublication:boolean}|null;userErrors:Array<{field:string[];message:string}>}}>(credential,
    `mutation PublishProduct($id:ID!,$input:[PublicationInput!]!,$publicationId:ID!){
      publishablePublish(id:$id,input:$input){
        publishable{publishedOnPublication(publicationId:$publicationId)}
        userErrors{field message}
      }
    }`,{id:product.id,input:[{publicationId}],publicationId});
  if(published.publishablePublish.userErrors.length)throw new Error(`Shopify publish error: ${published.publishablePublish.userErrors.map((e)=>e.message).join('; ')}`);

  const faq=await ensurePage(credential,'FAQ','faq',
    '<h2>Frequently Asked Questions</h2><p>Product compatibility, use, shipping, and returns are answered from verified product and store information. If a detail is not verified, support will say so rather than guess.</p>');
  const shipping=await ensurePage(credential,'Shipping & Returns','shipping-returns',
    '<h2>Shipping & Returns</h2><p>Delivery estimates depend on the connected fulfillment source and destination. Exact windows are only shown after they are verified. Return requests are handled according to the store policy and order status.</p>');

  const theme=await buildAndPublishTheme(
    async <T>(query:string,variables:Record<string,unknown>={})=>graph<T>(credential,query,variables),
    pkg,product.handle,title
  );
  const meta=connection.metadata||{};
  const primary=String(meta.primaryDomain?.url||`https://${credential.storeDomain}`).replace(/\/$/,'');
  const productUrl=`${primary}/products/${product.handle}`;
  const liveCheck=await fetch(productUrl,{redirect:'follow',headers:{'user-agent':'AI-Employee-OS-QA/0.4'}});
  const storefrontReachable=liveCheck.ok;
  const result={
    storeDomain:credential.storeDomain,
    primaryDomain:primary,
    productId:product.id,
    productHandle:product.handle,
    productUrl,
    price,
    published:Boolean(published.publishablePublish.publishable?.publishedOnPublication),
    storefrontReachable,
    homepageReachable:false,
    theme,
    faqPage:faq,
    shippingPage:shipping,
    supplier:{
      provider:'CJ',
      mappingId:String(mapping.id),
      supplierProductId:String(mapping.supplier_product_id),
      supplierVariantId:String(mapping.supplier_variant_id),
      supplierSku:String(mapping.supplier_sku||''),
      sourcePrice:Number(mapping.source_price),
      freightCostEstimate:Number(mapping.freight_cost_estimate),
      landedCostEstimate:Number(mapping.landed_cost_estimate),
      stockState:String(mapping.stock_state)
    },
    executedAt:new Date().toISOString()
  };
  const homepageCheck=await fetch(primary+'/',{redirect:'follow',headers:{'user-agent':'AI-Employee-OS-QA/0.5'}});
  result.homepageReachable=homepageCheck.ok;
  if(!result.homepageReachable||!result.storefrontReachable){
    throw new Error('Shopify storefront QA failed: homepage or product URL is not reachable after theme publication.');
  }
  await pool.query(`UPDATE link_launches SET status='STORE_LIVE',store_url=$2,product_url=$3,updated_at=now()
    WHERE project_id=$1`,[input.projectId,primary,productUrl]);
  await pool.query(`UPDATE store_packages SET status=$2,external_state=$3,updated_at=now() WHERE id=$1`,[
    pkg.id,
    result.published&&storefrontReachable?'LIVE':'EXTERNAL_QA_FAILED',
    JSON.stringify({shopify:'CONNECTED',publishAllowed:true,...result})
  ]);
  await pool.query(`UPDATE projects SET phase=$2,updated_at=now() WHERE id=$1`,[
    input.projectId,result.published&&storefrontReachable?'STORE_LIVE':'STORE_EXTERNAL_QA'
  ]);
  return result;
}



export type DurableVideoAsset={
  shopifyFileId:string;
  filename:string;
  url:string;
  fileStatus:string;
  mediaStatus:string;
  sourceTaskId:string;
  promptText:string;
};

async function latestShopifyConnection(companyId:string){
  const r=await pool.query(`SELECT * FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)throw new Error('BLOCKED_EXTERNAL_AUTH: Shopify is not connected for durable video storage.');
  const connection=r.rows[0];
  const credential=await readCredential<ShopifyCredential>(companyId,'SHOPIFY',String(connection.id));
  return {connection,credential};
}

async function waitVideoReady(credential:ShopifyCredential,id:string){
  for(let i=0;i<60;i++){
    const data=await graph<{node:{
      id:string;filename:string;fileStatus:string;status:string;
      sources:Array<{url:string;mimeType:string;format:string;width:number;height:number}>
    }|null}>(credential,`query VideoReady($id:ID!){
      node(id:$id){... on Video{id filename fileStatus status sources{url mimeType format width height}}}
    }`,{id});
    const node=data.node;
    if(node?.fileStatus==='FAILED'||node?.status==='FAILED')throw new Error(`Shopify video processing failed for ${node.filename}.`);
    if(node?.fileStatus==='READY'&&node?.status==='READY'&&node.sources?.length)return node;
    await new Promise((resolve)=>setTimeout(resolve,1500));
  }
  throw new Error('Shopify video did not become READY before timeout.');
}

export async function persistVideosToShopify(input:{
  companyId:string;
  projectId:string;
  creativePackageId:string;
  assets:Array<{taskId:string;temporaryUrl:string;promptText:string;specId:string}>;
}):Promise<DurableVideoAsset[]>{
  const {credential}=await latestShopifyConnection(input.companyId);
  const output:DurableVideoAsset[]=[];
  let index=0;
  for(const asset of input.assets){
    index++;
    const mediaResponse=await fetch(asset.temporaryUrl,{redirect:'follow',headers:{'user-agent':'AI-Employee-OS-Renderer/0.6'}});
    if(!mediaResponse.ok)throw new Error(`Runway output download failed (HTTP ${mediaResponse.status}).`);
    const bytes=Buffer.from(await mediaResponse.arrayBuffer());
    if(!bytes.length)throw new Error('Runway output video was empty.');
    if(bytes.length>250*1024*1024)throw new Error('Rendered video exceeds the 250 MB persistence limit.');
    const filename=`employee-os-${input.projectId.slice(0,8)}-${String(index).padStart(2,'0')}.mp4`;

    const staged=await graph<{stagedUploadsCreate:{
      stagedTargets:Array<{url:string;resourceUrl:string;parameters:Array<{name:string;value:string}>}>,
      userErrors:Array<{field:string[];message:string}>
    }}>(credential,`mutation StageVideo($input:[StagedUploadInput!]!){
      stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}
    }`,{input:[{resource:'VIDEO',filename,mimeType:'video/mp4',httpMethod:'POST',fileSize:String(bytes.length)}]});
    if(staged.stagedUploadsCreate.userErrors.length)throw new Error(
      'Shopify staged upload error: '+staged.stagedUploadsCreate.userErrors.map((e)=>e.message).join('; ')
    );
    const target=staged.stagedUploadsCreate.stagedTargets[0];
    if(!target)throw new Error('Shopify did not return a staged video upload target.');

    const form=new FormData();
    for(const p of target.parameters)form.append(p.name,p.value);
    form.append('file',new Blob([bytes],{type:'video/mp4'}),filename);
    const upload=await fetch(target.url,{method:'POST',body:form});
    if(!upload.ok)throw new Error(`Shopify staged video upload failed (HTTP ${upload.status}).`);

    const created=await graph<{fileCreate:{
      files:Array<{id:string;filename:string;fileStatus:string;status:string;sources:Array<{url:string;mimeType:string;format:string;width:number;height:number}>}>,
      userErrors:Array<{field:string[];message:string}>
    }}>(credential,`mutation PersistVideo($files:[FileCreateInput!]!){
      fileCreate(files:$files){files{... on Video{id filename fileStatus status sources{url mimeType format width height}}} userErrors{field message}}
    }`,{files:[{
      originalSource:target.resourceUrl,contentType:'VIDEO',filename,
      alt:'Original product video generated by Employee OS',duplicateResolutionMode:'APPEND_UUID'
    }]});
    if(created.fileCreate.userErrors.length)throw new Error(
      'Shopify file create error: '+created.fileCreate.userErrors.map((e)=>e.message).join('; ')
    );
    const file=created.fileCreate.files[0];
    if(!file?.id)throw new Error('Shopify did not return a Video file ID.');
    const ready=await waitVideoReady(credential,file.id);
    const url=String(ready.sources?.[0]?.url||'');
    if(!url)throw new Error('Shopify video became READY without a public source URL.');
    output.push({
      shopifyFileId:ready.id,filename:ready.filename,url,fileStatus:ready.fileStatus,mediaStatus:ready.status,
      sourceTaskId:asset.taskId,promptText:asset.promptText
    });
  }

  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'CREATIVE_ASSETS_PERSISTED',$2)`,[
    input.companyId,JSON.stringify({
      projectId:input.projectId,creativePackageId:input.creativePackageId,
      assetCount:output.length,assetIds:output.map((x)=>x.shopifyFileId)
    })
  ]);
  return output;
}

export type ShopifyPaidOrder={
  id:string;
  name:string;
  createdAt:string;
  displayFinancialStatus:string;
  displayFulfillmentStatus:string;
  email:string|null;
  shippingAddress:{
    name:string;
    address1:string;
    address2:string|null;
    city:string;
    province:string|null;
    provinceCode:string|null;
    zip:string|null;
    country:string|null;
    countryCodeV2:string;
    phone:string|null;
  }|null;
  lineItems:{nodes:Array<{
    id:string;
    name:string;
    quantity:number;
    sku:string|null;
    variant:{id:string;sku:string|null;product:{id:string}}|null;
  }>};
};

export async function connectedShopifyCompanies(){
  const r=await pool.query(`SELECT company_id,id,metadata FROM tool_connections
    WHERE provider='SHOPIFY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 50`);
  return r.rows;
}

export async function listPaidUnfulfilledOrders(companyId:string):Promise<ShopifyPaidOrder[]>{
  const r=await pool.query(`SELECT * FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return [];
  const connection=r.rows[0];
  const credential=await readCredential<ShopifyCredential>(companyId,'SHOPIFY',String(connection.id));
  const data=await graph<{orders:{nodes:ShopifyPaidOrder[]}}>(credential,`query PaidUnfulfilledOrders($query:String!){
    orders(first:25,query:$query,sortKey:CREATED_AT,reverse:true){
      nodes{
        id name createdAt displayFinancialStatus displayFulfillmentStatus email
        shippingAddress{name address1 address2 city province provinceCode zip country countryCodeV2 phone}
        lineItems(first:50){nodes{id name quantity sku variant{id sku product{id}}}}
      }
    }
  }`,{query:'financial_status:paid fulfillment_status:unfulfilled'});
  return data.orders.nodes.filter((o)=>o.displayFinancialStatus==='PAID');
}


type FulfillmentOrderNode={
  id:string;
  status:string;
  requestStatus:string;
  supportedActions:Array<{action:string}>;
  lineItems:{nodes:Array<{id:string;remainingQuantity:number;lineItem:{id:string}}>} ;
};

export async function syncShopifyFulfillmentTracking(input:{
  companyId:string;
  shopifyOrderId:string;
  trackingNumber:string;
  trackingUrl?:string|null;
  trackingCompany?:string|null;
  existingFulfillments?:Array<{id:string;fulfillmentOrderId?:string;trackingNumber?:string}>;
}){
  if(!input.trackingNumber)throw new Error('Tracking number is required for Shopify fulfillment sync.');
  const r=await pool.query(`SELECT * FROM tool_connections
    WHERE company_id=$1 AND provider='SHOPIFY' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[input.companyId]);
  if(!r.rowCount)throw new Error('BLOCKED_EXTERNAL_AUTH: Shopify store execution is not connected');
  const connection=r.rows[0];
  const credential=await readCredential<ShopifyCredential>(input.companyId,'SHOPIFY',String(connection.id));
  const existing=Array.isArray(input.existingFulfillments)?input.existingFulfillments:[];

  const orderData=await graph<{order:{
    id:string;
    fulfillmentOrders:{nodes:FulfillmentOrderNode[]};
  }|null}>(credential,`query FulfillmentOrdersForOrder($id:ID!){
    order(id:$id){
      id
      fulfillmentOrders(first:20){
        nodes{
          id status requestStatus supportedActions{action}
          lineItems(first:100){nodes{id remainingQuantity lineItem{id}}}
        }
      }
    }
  }`,{id:input.shopifyOrderId});
  if(!orderData.order)throw new Error('Shopify order not found during fulfillment sync.');

  const results:Array<{id:string;fulfillmentOrderId:string;trackingNumber:string;status:string}>=[];

  for(const fo of orderData.order.fulfillmentOrders.nodes){
    const prior=existing.find((x)=>x.fulfillmentOrderId===fo.id);
    if(prior?.id){
      const updated=await graph<{fulfillmentTrackingInfoUpdate:{
        fulfillment:{id:string;status:string;trackingInfo:Array<{number:string|null;url:string|null;company:string|null}>}|null;
        userErrors:Array<{field:string[];message:string}>;
      }}>(credential,`mutation UpdateFulfillmentTracking($fulfillmentId:ID!,$tracking:FulfillmentTrackingInput!){
        fulfillmentTrackingInfoUpdate(fulfillmentId:$fulfillmentId,trackingInfoInput:$tracking,notifyCustomer:true){
          fulfillment{id status trackingInfo{number url company}}
          userErrors{field message}
        }
      }`,{
        fulfillmentId:prior.id,
        tracking:{
          number:input.trackingNumber,
          url:input.trackingUrl||undefined,
          company:input.trackingCompany||undefined
        }
      });
      if(updated.fulfillmentTrackingInfoUpdate.userErrors.length){
        throw new Error(`Shopify tracking update error: ${updated.fulfillmentTrackingInfoUpdate.userErrors.map((e)=>e.message).join('; ')}`);
      }
      if(updated.fulfillmentTrackingInfoUpdate.fulfillment){
        results.push({id:prior.id,fulfillmentOrderId:fo.id,trackingNumber:input.trackingNumber,status:updated.fulfillmentTrackingInfoUpdate.fulfillment.status});
      }
      continue;
    }

    const canCreate=fo.supportedActions.some((x)=>x.action==='CREATE_FULFILLMENT')||['OPEN','IN_PROGRESS'].includes(fo.status);
    if(!canCreate)continue;
    const remaining=fo.lineItems.nodes.filter((li)=>Number(li.remainingQuantity)>0);
    if(!remaining.length)continue;

    const created=await graph<{fulfillmentCreate:{
      fulfillment:{id:string;status:string;trackingInfo:Array<{number:string|null;url:string|null;company:string|null}>}|null;
      userErrors:Array<{field:string[];message:string}>;
    }}>(credential,`mutation CreateFulfillment($fulfillment:FulfillmentInput!){
      fulfillmentCreate(fulfillment:$fulfillment){
        fulfillment{id status trackingInfo{number url company}}
        userErrors{field message}
      }
    }`,{fulfillment:{
      notifyCustomer:true,
      trackingInfo:{
        number:input.trackingNumber,
        url:input.trackingUrl||undefined,
        company:input.trackingCompany||undefined
      },
      lineItemsByFulfillmentOrder:[{
        fulfillmentOrderId:fo.id,
        fulfillmentOrderLineItems:remaining.map((li)=>({id:li.id,quantity:Number(li.remainingQuantity)}))
      }]
    }});
    if(created.fulfillmentCreate.userErrors.length){
      throw new Error(`Shopify fulfillment error: ${created.fulfillmentCreate.userErrors.map((e)=>e.message).join('; ')}`);
    }
    const fulfillment=created.fulfillmentCreate.fulfillment;
    if(fulfillment){
      results.push({id:fulfillment.id,fulfillmentOrderId:fo.id,trackingNumber:input.trackingNumber,status:fulfillment.status});
    }
  }

  if(!results.length&&existing.length===0){
    throw new Error('No Shopify fulfillment order was eligible for fulfillment.');
  }
  return results.length?results:existing.map((x)=>({id:x.id,fulfillmentOrderId:String(x.fulfillmentOrderId||''),trackingNumber:input.trackingNumber,status:'SUCCESS'}));
}
