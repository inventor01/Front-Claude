import { pool } from './db.js';
import { readCredential,storeCredential,deleteCredential } from './credentials.js';

const API_VERSION='2026-07';

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
  const response=await fetch(`https://${credential.storeDomain}/admin/api/${API_VERSION}/graphql.json`,{
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
  const required=['write_products','read_publications','write_publications','read_content','write_content'];
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
  const price=safePrice(candidate);
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
    faqPage:faq,
    shippingPage:shipping,
    executedAt:new Date().toISOString()
  };
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
