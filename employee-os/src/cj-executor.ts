import { pool } from './db.js';
import { readCredential,storeCredential,deleteCredential } from './credentials.js';

const PROVIDER_TEST_MODE=process.env.PROVIDER_TEST_MODE==='1';
const BASE=PROVIDER_TEST_MODE&&process.env.CJ_TEST_BASE_URL
  ?String(process.env.CJ_TEST_BASE_URL).replace(/\/$/,'')
  :'https://developers.cjdropshipping.com/api2.0/v1';

type CjCredential={
  apiKey:string;
  accessToken:string;
  accessTokenExpiryDate:string;
  refreshToken:string;
  refreshTokenExpiryDate:string;
  openId:string;
};

type CjEnvelope<T>={code:number;result:boolean;message:string;data:T;success?:boolean;requestId?:string};

async function requestJson<T>(url:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(url,init);
  const text=await response.text();
  if(!response.ok)throw new Error(`CJ HTTP ${response.status}: ${text.slice(0,900)}`);
  let body:CjEnvelope<T>;
  try{body=JSON.parse(text) as CjEnvelope<T>;}catch{throw new Error('CJ returned invalid JSON.');}
  if(body.code!==200||body.result!==true)throw new Error(`CJ API ${body.code}: ${body.message||'request failed'}`);
  return body.data;
}

async function refreshCredential(companyId:string,connectionId:string,credential:CjCredential){
  const expiry=Date.parse(credential.accessTokenExpiryDate||'');
  if(Number.isFinite(expiry)&&expiry-Date.now()>7*24*60*60*1000)return credential;
  const refreshExpiry=Date.parse(credential.refreshTokenExpiryDate||'');
  if(Number.isFinite(refreshExpiry)&&refreshExpiry<=Date.now()){
    const data=await requestJson<any>(`${BASE}/authentication/getAccessToken`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({apiKey:credential.apiKey})
    });
    const next:CjCredential={...credential,...data,openId:String(data.openId||credential.openId)};
    await storeCredential({companyId,provider:'CJ',connectionId,secret:next});
    return next;
  }
  const data=await requestJson<any>(`${BASE}/authentication/refreshAccessToken`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refreshToken:credential.refreshToken})
  });
  const next:CjCredential={...credential,...data};
  await storeCredential({companyId,provider:'CJ',connectionId,secret:next});
  return next;
}

async function credentialFor(companyId:string){
  const r=await pool.query(`SELECT * FROM tool_connections WHERE company_id=$1 AND provider='CJ' AND status='CONNECTED'
    ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)throw new Error('BLOCKED_EXTERNAL_AUTH: CJdropshipping is not connected');
  const connection=r.rows[0];
  let credential=await readCredential<CjCredential>(companyId,'CJ',String(connection.id));
  credential=await refreshCredential(companyId,String(connection.id),credential);
  return {connection,credential};
}

async function cjGet<T>(companyId:string,path:string,params:Record<string,string|number|undefined>={}){
  const {credential}=await credentialFor(companyId);
  const url=new URL(BASE+path);
  for(const [k,v] of Object.entries(params))if(v!==undefined&&v!=='')url.searchParams.set(k,String(v));
  return requestJson<T>(url.href,{headers:{'CJ-Access-Token':credential.accessToken,'user-agent':'AI-Employee-OS/0.4'}});
}

async function cjPost<T>(companyId:string,path:string,body:unknown){
  const {credential}=await credentialFor(companyId);
  return requestJson<T>(BASE+path,{
    method:'POST',
    headers:{'content-type':'application/json','CJ-Access-Token':credential.accessToken,'user-agent':'AI-Employee-OS/0.4'},
    body:JSON.stringify(body)
  });
}

function normalize(value:string){return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();}
function tokens(value:string){return new Set(normalize(value).split(/\s+/).filter((x)=>x.length>1));}
function matchScore(query:string,name:string){
  const q=tokens(query),n=tokens(name); if(!q.size||!n.size)return 0;
  let common=0;for(const x of q)if(n.has(x))common++;
  let score=Math.round((common/q.size)*75+(common/Math.max(q.size,n.size))*25);
  if(normalize(name).includes(normalize(query)))score=Math.max(score,95);
  return Math.min(100,score);
}
function minNumber(value:unknown){
  const found=String(value??'').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite)||[];
  return found.length?Math.min(...found):0;
}
function freightCost(option:any){
  const candidates=[
    option?.logisticPrice,option?.freight,option?.price,option?.totalPostage,
    option?.amount,option?.totalFreight,option?.shippingFee,option?.logisticsPrice
  ].map(Number).filter((x)=>Number.isFinite(x)&&x>=0);
  return candidates.length?Math.min(...candidates):null;
}

export async function connectCJ(input:{companyId:string;apiKey:string}){
  const apiKey=input.apiKey.trim();
  const data=await requestJson<any>(`${BASE}/authentication/getAccessToken`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({apiKey})
  });
  const credential:CjCredential={
    apiKey,
    accessToken:String(data.accessToken||''),
    accessTokenExpiryDate:String(data.accessTokenExpiryDate||''),
    refreshToken:String(data.refreshToken||''),
    refreshTokenExpiryDate:String(data.refreshTokenExpiryDate||''),
    openId:String(data.openId||'')
  };
  if(!credential.accessToken||!credential.refreshToken)throw new Error('CJ authentication did not return the expected tokens.');

  const existing=await pool.query(`SELECT * FROM tool_connections WHERE company_id=$1 AND provider='CJ' ORDER BY updated_at DESC LIMIT 1`,[input.companyId]);
  const metadata={
    openId:credential.openId,
    accessTokenExpiryDate:credential.accessTokenExpiryDate,
    refreshTokenExpiryDate:credential.refreshTokenExpiryDate,
    apiVersion:'2.0',
    connectedAt:new Date().toISOString()
  };
  let connection;
  if(existing.rowCount){
    const r=await pool.query(`UPDATE tool_connections SET tool_id='cj-dropshipping',risk_class='HIGH',status='CONNECTED',
      metadata=$2,updated_at=now() WHERE id=$1 RETURNING *`,[existing.rows[0].id,JSON.stringify(metadata)]);
    connection=r.rows[0];
  }else{
    const r=await pool.query(`INSERT INTO tool_connections(company_id,tool_id,provider,risk_class,status,metadata)
      VALUES($1,'cj-dropshipping','CJ','HIGH','CONNECTED',$2) RETURNING *`,[input.companyId,JSON.stringify(metadata)]);
    connection=r.rows[0];
  }
  await storeCredential({companyId:input.companyId,provider:'CJ',connectionId:String(connection.id),secret:credential});
  return {connection:{id:connection.id,status:connection.status,metadata},openId:credential.openId};
}

export async function disconnectCJ(companyId:string){
  const r=await pool.query(`SELECT id FROM tool_connections WHERE company_id=$1 AND provider='CJ' ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {disconnected:false};
  const id=String(r.rows[0].id);
  await deleteCredential(companyId,'CJ',id);
  await pool.query(`UPDATE tool_connections SET status='DISCONNECTED',updated_at=now() WHERE id=$1`,[id]);
  return {disconnected:true};
}

export async function cjStatus(companyId:string){
  const r=await pool.query(`SELECT id,status,metadata,updated_at FROM tool_connections
    WHERE company_id=$1 AND provider='CJ' ORDER BY updated_at DESC LIMIT 1`,[companyId]);
  if(!r.rowCount)return {connected:false,status:'NOT_CONNECTED'};
  return {connected:r.rows[0].status==='CONNECTED',status:r.rows[0].status,metadata:r.rows[0].metadata,updatedAt:r.rows[0].updated_at};
}

function flattenProducts(data:any){
  const content=Array.isArray(data?.content)?data.content:[];
  const products:any[]=[];
  for(const row of content){
    if(Array.isArray(row?.productList))products.push(...row.productList);
    else if(row&&typeof row==='object')products.push(row);
  }
  if(Array.isArray(data?.productList))products.push(...data.productList);
  return products;
}

export async function searchCJ(companyId:string,query:string){
  const data=await cjGet<any>(companyId,'/product/listV2',{page:1,size:20,keyWord:query,verifiedWarehouse:1,startInventory:1});
  const products=flattenProducts(data).map((p:any)=>({
    id:String(p.id||p.pid||''),
    name:String(p.nameEn||p.productNameEn||p.name||''),
    sku:String(p.sku||p.spu||p.productSku||''),
    image:String(p.bigImage||p.productImage||''),
    sellPrice:String(p.sellPrice||p.nowPrice||''),
    sourcePrice:minNumber(p.nowPrice||p.sellPrice),
    listedNum:Number(p.listedNum||0),
    verifiedInventory:Number(p.totalVerifiedInventory||0),
    totalInventory:Number(p.warehouseInventoryNum??p.totalVerifiedInventory??0),
    supplierName:String(p.supplierName||''),
    matchScore:matchScore(query,String(p.nameEn||p.productNameEn||p.name||''))
  })).filter((p:any)=>p.id&&p.name).sort((a:any,b:any)=>b.matchScore-a.matchScore||b.listedNum-a.listedNum);
  return products;
}

export async function mapCandidateToCJ(companyId:string,candidateId:string){
  const c=await pool.query('SELECT * FROM product_candidates WHERE id=$1 AND company_id=$2',[candidateId,companyId]);
  if(!c.rowCount)throw new Error('Product candidate not found for CJ mapping.');
  const candidate=c.rows[0];
  const products=await searchCJ(companyId,String(candidate.name));
  const best=products[0];
  if(!best)throw new Error('BLOCKED_SUPPLIER_MAPPING: CJ returned no matching products.');
  const second=products[1];
  if(best.matchScore<60)throw new Error(`BLOCKED_SUPPLIER_MAPPING: Best CJ match is too weak (${best.matchScore}/100).`);
  if(second&&best.matchScore-second.matchScore<8&&second.matchScore>=60){
    return {status:'NEEDS_REVIEW',candidateId,options:products.slice(0,5)};
  }

  const variants=await cjGet<any[]>(companyId,'/product/variant/query',{pid:best.id});
  const list=Array.isArray(variants)?variants:[];
  if(!list.length)throw new Error('BLOCKED_SUPPLIER_MAPPING: CJ product has no variants.');
  const variant=list.map((v:any)=>({
    vid:String(v.vid||''),
    sku:String(v.variantSku||''),
    name:String(v.variantNameEn||v.variantName||v.variantKey||'Default'),
    price:Number(v.variantSellPrice||0),
    image:String(v.variantImage||'')
  })).filter((v:any)=>v.vid&&v.price>0).sort((a:any,b:any)=>a.price-b.price)[0];
  if(!variant)throw new Error('BLOCKED_SUPPLIER_MAPPING: CJ product has no priced variant.');

  const [stock,variantDetail]=await Promise.all([
    cjGet<any[]>(companyId,'/product/stock/queryByVid',{vid:variant.vid}),
    cjGet<any>(companyId,'/product/variant/queryByVid',{vid:variant.vid,features:'enable_inventory'})
  ]);
  const warehouses=Array.isArray(stock)?stock:[];
  const totalInventory=warehouses.reduce((sum:number,w:any)=>sum+Math.max(0,Number(w.totalInventoryNum||0)),0);
  if(totalInventory<=0)throw new Error('BLOCKED_SUPPLIER_STOCK: CJ variant currently shows no inventory.');

  const detailInventories=Array.isArray(variantDetail?.inventories)?variantDetail.inventories:[];
  const verifiedInventory=detailInventories
    .filter((w:any)=>Number(w.verifiedWarehouse)===1)
    .reduce((sum:number,w:any)=>sum+Math.max(0,Number(w.totalInventory||w.totalInventoryNum||0)),0);
  if(verifiedInventory<=0){
    throw new Error('BLOCKED_SUPPLIER_STOCK: CJ variant does not show verified warehouse inventory.');
  }

  const origin=String(
    detailInventories.find((w:any)=>Number(w.verifiedWarehouse)===1&&Number(w.totalInventory||w.totalInventoryNum||0)>0)?.countryCode||
    warehouses.find((w:any)=>Number(w.totalInventoryNum||0)>0)?.countryCode||
    'CN'
  );
  const freight=await cjPost<any>(companyId,'/logistic/freightCalculate',{
    startCountryCode:origin,endCountryCode:'US',products:[{quantity:1,vid:variant.vid}]
  });
  const options=Array.isArray(freight)?freight:Array.isArray(freight?.list)?freight.list:Array.isArray(freight?.logistics)?freight.logistics:[];
  if(!options.length)throw new Error('BLOCKED_SUPPLIER_FREIGHT: CJ returned no U.S. freight option for this variant.');
  const costs=options.map(freightCost).filter((x:number|null): x is number => x!==null&&Number.isFinite(x));
  const minFreight=costs.length?Math.min(...costs):null;
  if(minFreight===null)throw new Error('BLOCKED_SUPPLIER_FREIGHT: CJ freight options did not include a usable price.');

  const landed=variant.price+minFreight;
  const market=Number(candidate.observed_market_price||0);
  const marginPct=market>0?((market-landed)/market)*100:null;
  const status='VERIFIED';
  const mapping=await pool.query(`INSERT INTO supplier_product_mappings(
    company_id,candidate_id,provider,supplier_product_id,supplier_variant_id,supplier_sku,product_name,variant_name,
    source_price,stock_state,stock_detail,freight_state,freight_options,match_score,status,verified_at,
    freight_cost_estimate,landed_cost_estimate
  ) VALUES($1,$2,'CJ',$3,$4,$5,$6,$7,$8,$9,$10,'VERIFIED',$11,$12,$13,now(),$14,$15)
  ON CONFLICT(company_id,candidate_id,provider) DO UPDATE SET
    supplier_product_id=EXCLUDED.supplier_product_id,supplier_variant_id=EXCLUDED.supplier_variant_id,
    supplier_sku=EXCLUDED.supplier_sku,product_name=EXCLUDED.product_name,variant_name=EXCLUDED.variant_name,
    source_price=EXCLUDED.source_price,stock_state=EXCLUDED.stock_state,stock_detail=EXCLUDED.stock_detail,
    freight_state=EXCLUDED.freight_state,freight_options=EXCLUDED.freight_options,match_score=EXCLUDED.match_score,
    status=EXCLUDED.status,verified_at=now(),freight_cost_estimate=EXCLUDED.freight_cost_estimate,
    landed_cost_estimate=EXCLUDED.landed_cost_estimate,updated_at=now()
  RETURNING *`,[
    companyId,candidateId,best.id,variant.vid,variant.sku,best.name,variant.name,variant.price,
    'VERIFIED_IN_STOCK',
    JSON.stringify({warehouses,totalInventory,verifiedInventory,origin}),
    JSON.stringify(options),best.matchScore,status,minFreight,landed
  ]);
  if(market>0&&marginPct!==null){
    await pool.query(`UPDATE product_candidates SET observed_source_price=$2,observed_gross_margin_pct=$3,
      analysis=jsonb_set(jsonb_set(analysis,'{supplierProvider}',to_jsonb('CJ'::text),true),'{landedCostEstimate}',to_jsonb($4::numeric),true),
      updated_at=now() WHERE id=$1`,[candidateId,variant.price,marginPct,landed]);
  }
  return {status:'VERIFIED',mapping:mapping.rows[0],alternatives:products.slice(1,5)};
}

export async function requireVerifiedCJMapping(companyId:string,candidateId:string){
  const r=await pool.query(`SELECT * FROM supplier_product_mappings WHERE company_id=$1 AND candidate_id=$2 AND provider='CJ'
    AND status='VERIFIED' AND stock_state='VERIFIED_IN_STOCK' AND freight_state='VERIFIED'
    ORDER BY verified_at DESC LIMIT 1`,[companyId,candidateId]);
  if(!r.rowCount)throw new Error('BLOCKED_FULFILLMENT: A verified CJ supplier mapping with freight evidence is required before publication.');
  const row=r.rows[0];
  if(Number(row.landed_cost_estimate||0)<=0)throw new Error('BLOCKED_FULFILLMENT: Supplier mapping is missing landed-cost evidence.');
  return row;
}


function logisticsName(mapping:any){
  const options=Array.isArray(mapping.freight_options)?mapping.freight_options:[];
  if(!options.length)throw new Error('CJ mapping is missing freight options.');
  const scored=options.map((option:any)=>({option,cost:freightCost(option)}))
    .filter((row:any)=>row.cost!==null)
    .sort((a:any,b:any)=>a.cost-b.cost);
  const selected=scored[0]?.option||options[0];
  const name=String(selected.logisticName||selected.logisticsName||selected.name||selected.enName||selected.logisticNameEn||'').trim();
  if(!name)throw new Error('CJ mapping freight option is missing logisticName.');
  return name;
}

function countryName(code:string){
  const names:Record<string,string>={US:'United States',CA:'Canada',GB:'United Kingdom',AU:'Australia'};
  return names[code.toUpperCase()]||code.toUpperCase();
}

export async function createCJOrderForShopify(input:{
  companyId:string;
  shopifyOrderId:string;
  shopifyOrderName:string;
  externalOrderNumber:string;
  shippingAddress:{
    name:string;address1:string;address2?:string|null;city:string;province?:string|null;
    zip?:string|null;country?:string|null;countryCodeV2:string;phone?:string|null;
  };
  lines:Array<{mappingId:string;quantity:number;shippingName:string}>;
}){
  if(!input.shippingAddress.name||!input.shippingAddress.address1||!input.shippingAddress.city||!input.shippingAddress.countryCodeV2){
    throw new Error('BLOCKED_CUSTOMER_DATA: CJ fulfillment requires recipient name, street, city, and country.');
  }
  if(!input.shippingAddress.phone){
    throw new Error('BLOCKED_CUSTOMER_DATA: CJ fulfillment requires a customer shipping phone number.');
  }
  if(!input.lines.length)throw new Error('BLOCKED_FULFILLMENT: No mapped CJ line items were supplied.');

  const mappings:any[]=[];
  for(const line of input.lines){
    const r=await pool.query(`SELECT * FROM supplier_product_mappings WHERE id=$1 AND company_id=$2 AND provider='CJ'`,[
      line.mappingId,input.companyId
    ]);
    if(!r.rowCount)throw new Error('BLOCKED_FULFILLMENT: Supplier mapping was not found for a Shopify line item.');
    mappings.push({...r.rows[0],quantity:line.quantity,shippingName:line.shippingName});
  }

  const first=mappings[0];
  const freightName=logisticsName(first);
  const origin=String(first.stock_detail?.origin||'CN');
  const body={
    orderNumber:input.externalOrderNumber.slice(0,50),
    shippingCountryCode:input.shippingAddress.countryCodeV2,
    shippingCountry:input.shippingAddress.country||countryName(input.shippingAddress.countryCodeV2),
    shippingProvince:input.shippingAddress.province||'',
    shippingCity:input.shippingAddress.city,
    shippingAddress:input.shippingAddress.address1,
    shippingAddress2:input.shippingAddress.address2||'',
    shippingCustomerName:input.shippingAddress.name,
    shippingZip:input.shippingAddress.zip||'',
    shippingPhone:input.shippingAddress.phone,
    remark:`Employee OS fulfillment for Shopify ${input.shopifyOrderName}`,
    logisticName:freightName,
    fromCountryCode:origin,
    platform:'Shopify',
    payType:3,
    isSandbox:0,
    products:mappings.map((m)=>({
      vid:String(m.supplier_variant_id),
      quantity:Number(m.quantity),
      shippingName:String(m.shippingName||m.product_name).slice(0,200)
    }))
  };
  const orderId=await cjPost<string>(input.companyId,'/shopping/order/createOrderV2',body);
  if(!orderId)throw new Error('CJ order creation returned no order id.');
  const detail=await cjGet<any>(input.companyId,'/shopping/order/getOrderDetail',{orderId});
  return {
    orderId,
    orderNumber:String(detail?.orderNum||input.externalOrderNumber),
    cjOrderCode:String(detail?.cjOrderCode||orderId),
    orderStatus:String(detail?.orderStatus||'CREATED'),
    amount:Number(detail?.orderAmount||0),
    productAmount:Number(detail?.productAmount||0),
    postageAmount:Number(detail?.postageAmount||0),
    trackingNumber:String(detail?.trackNumber||''),
    trackingUrl:String(detail?.trackingUrl||''),
    raw:detail
  };
}

export async function payCJOrder(companyId:string,shipmentOrderId:string){
  const balance=await cjGet<any>(companyId,'/shopping/pay/getBalance');
  const result=await cjPost<any>(companyId,'/shopping/pay/payBalanceV2',{shipmentOrderId});
  return {paid:true,balanceBefore:Number(balance?.amount||0),result};
}

export async function getCJOrderDetail(companyId:string,orderId:string){
  const detail=await cjGet<any>(companyId,'/shopping/order/getOrderDetail',{orderId});
  return {
    orderId:String(detail?.orderId||orderId),
    orderNumber:String(detail?.orderNum||''),
    cjOrderCode:String(detail?.cjOrderCode||orderId),
    orderStatus:String(detail?.orderStatus||'UNKNOWN'),
    amount:Number(detail?.orderAmount||0),
    productAmount:Number(detail?.productAmount||0),
    postageAmount:Number(detail?.postageAmount||0),
    trackingNumber:String(detail?.trackNumber||''),
    trackingProvider:String(detail?.trackingProvider||''),
    trackingUrl:String(detail?.trackingUrl||''),
    raw:detail
  };
}
