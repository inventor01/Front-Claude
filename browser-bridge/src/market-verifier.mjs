const clean=(v,max=500)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const money=(text)=>{const s=String(text||'').replace(/,/g,'');const m=s.match(/(?:US\s*)?\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);return m?Number(m[1]):null};
const quantile=(values,q)=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo)};
const tokens=(v)=>new Set(clean(v,400).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>2&&!['the','and','for','with','new','sale','free'].includes(x)));
const overlap=(a,b)=>{const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.min(A.size,B.size)};
const parseSoldDate=(text)=>{const m=String(text||'').match(/\bSold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);if(!m)return null;const d=new Date(m[1]);return Number.isFinite(d.getTime())?d:null};
const daysAgo=(date,now=Date.now())=>date?Math.max(0,(now-date.getTime())/86400000):null;
const plausibleGtin=(v)=>/^\d{8,14}$/.test(String(v||'').trim());
const plausibleMpn=(v)=>{const x=clean(v,80);return x.length>=3&&!/^wks_/i.test(x)&&!/^shopify/i.test(x)};
function normalizedInput(raw={}){
  const title=clean(raw.title,240),brand=clean(raw.brand,100),gtin=clean(raw.gtin,30),mpn=clean(raw.mpn,100);
  let query='',basis='title',strict=false;
  if(plausibleGtin(gtin)){query=gtin;basis='gtin';strict=true}
  else if(brand&&plausibleMpn(mpn)){query=[brand,mpn].join(' ');basis='brand_mpn';strict=true}
  else query=[brand,title].filter(Boolean).join(' ').slice(0,150);
  if(!query)throw new Error('A GTIN, brand + MPN, or product title is required.');
  return {title,brand,gtin,mpn,query,basis,strict,location:clean(raw.location||'Detroit, MI',100),maxResults:Math.max(5,Math.min(40,Number(raw.maxResults||20)))};
}
function shippingAmount(text){if(/free\s+(?:shipping|delivery)/i.test(String(text||'')))return 0;const m=String(text||'').replace(/,/g,'').match(/\+?\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s+(?:shipping|delivery)/i);return m?Number(m[1]):null}
async function openPage(context,url,waitMs=2200){
  const page=await context.newPage();
  try{await page.goto(url,{waitUntil:'commit',timeout:25000});await page.waitForLoadState('domcontentloaded',{timeout:12000}).catch(()=>{});await page.waitForTimeout(waitMs);return page}
  catch(error){await page.close().catch(()=>{});throw error}
}
async function detailIdentity(context,url,input){
  const page=await openPage(context,url,900);
  try{
    const body=clean(await page.locator('body').innerText().catch(()=>''),60000).toLowerCase();
    if(input.basis==='gtin')return body.includes(input.gtin);
    if(input.basis==='brand_mpn')return body.includes(input.mpn.toLowerCase())&&(!input.brand||body.includes(input.brand.toLowerCase()));
    return overlap(input.title,body.slice(0,5000))>=0.55;
  }finally{await page.close().catch(()=>{})}
}
export async function collectEbaySold(context,raw={}){
  const input=normalizedInput(raw);
  const url='https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(input.query)+'&LH_Sold=1&LH_Complete=1&rt=nc';
  const page=await openPage(context,url,2600);
  try{
    const current=page.url(),body=clean(await page.locator('body').innerText().catch(()=>''),50000),soldFilterVerified=/[?&]LH_Sold=1(?:&|$)/.test(current)&&/[?&]LH_Complete=1(?:&|$)/.test(current);
    const authenticated=!/signin|sign in or register|security measure/i.test(current+' '+body);
    if(!authenticated)return {ok:false,source:'ebay-completed-browser',authenticated:false,sold_filter_verified:false,query:input.query,query_basis:input.basis,error:'eBay sold/completed search requires an authenticated eBay session in Front Chrome.',results:[]};
    const rawRows=await page.locator('li.s-item').evaluateAll((cards)=>cards.map((card)=>{
      const q=(s)=>card.querySelector(s);
      return {
        title:(q('.s-item__title')?.textContent||'').trim(),
        priceText:(q('.s-item__price')?.textContent||'').trim(),
        shippingText:(q('.s-item__shipping,.s-item__logisticsCost')?.textContent||'').trim(),
        dateText:(q('.s-item__caption--signal,.s-item__ended-date,.s-item__title--tagblock')?.textContent||'').trim(),
        condition:(q('.SECONDARY_INFO')?.textContent||'').trim(),
        url:q('a.s-item__link')?.href||'',
        text:(card.innerText||'').trim()
      };
    })).catch(()=>[]);
    let rows=rawRows.map(r=>({...r,item_price:money(r.priceText),buyer_shipping:shippingAmount(r.shippingText)}))
      .filter(r=>r.item_price>0&&r.url&&r.title&&!/^shop on ebay$/i.test(r.title));
    if(input.brand)rows=rows.filter(r=>!r.title||r.title.toLowerCase().includes(input.brand.toLowerCase())||overlap(input.title,r.title)>=0.55);
    if(input.basis==='title')rows=rows.filter(r=>overlap(input.title,r.title)>=0.62);
    rows=rows.slice(0,input.maxResults);
    let identityVerified=0;
    for(const row of rows.slice(0,Math.min(10,rows.length))){
      let exact=false;
      const hay=(row.text+' '+row.title).toLowerCase();
      if(input.basis==='gtin'&&hay.includes(input.gtin))exact=true;
      else if(input.basis==='brand_mpn'&&hay.includes(input.mpn.toLowerCase())&&(!input.brand||hay.includes(input.brand.toLowerCase())))exact=true;
      if(!exact&&input.strict)exact=await detailIdentity(context,row.url,input).catch(()=>false);
      row.identity_verified=input.strict?exact:overlap(input.title,row.title)>=0.7;
      if(row.identity_verified)identityVerified++;
    }
    if(input.strict)rows=rows.filter(r=>r.identity_verified);
    const prices=rows.map(r=>r.item_price).filter(Number.isFinite),now=Date.now();
    for(const r of rows){const d=parseSoldDate(r.dateText+' '+r.text);r.sold_at=d?d.toISOString():null;r.days_ago=daysAgo(d,now)}
    const dated=rows.filter(r=>Number.isFinite(r.days_ago));
    const sold30=dated.filter(r=>r.days_ago<=30).length,sold90=dated.filter(r=>r.days_ago<=90).length;
    const identityRequired=input.strict?Math.min(3,rows.length):0;
    const identityReady=input.strict?identityVerified>=identityRequired&&identityRequired>0:false;
    return {
      ok:true,source:'ebay-completed-browser',authenticated:true,sold_filter_verified:soldFilterVerified,query:input.query,query_basis:input.basis,strict_identity:input.strict,
      identity_verified:identityReady,identity_verified_count:identityVerified,verified_sold_count:rows.length,dated_sold_count:dated.length,sold_30_observed:sold30,sold_90_observed:sold90,
      conservative_item_price:quantile(prices,.25),median_item_price:quantile(prices,.5),low_item_price:prices.length?Math.min(...prices):null,high_item_price:prices.length?Math.max(...prices):null,
      median_buyer_shipping:quantile(rows.map(r=>r.buyer_shipping).filter(Number.isFinite),.5),price_basis:'completed eBay item price; buyer-paid shipping excluded from resale value',
      page_url:current,results:rows.slice(0,20),captured_at:new Date().toISOString()
    };
  }finally{await page.close().catch(()=>{})}
}
function fbSlug(location){const city=clean(location,100).split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g,'').trim();return city||'detroit'}
async function collectFacebookRows(page){
  return page.locator('a[href*="/marketplace/item/"]').evaluateAll((links)=>{
    const seen=new Set(),out=[];
    for(const a of links){
      const href=a.href||'';const id=href.match(/\/marketplace\/item\/(\d+)/)?.[1];if(!id||seen.has(id))continue;seen.add(id);
      let node=a,best=(a.innerText||'').trim();
      for(let i=0;i<5&&node?.parentElement;i++){node=node.parentElement;const t=(node.innerText||'').trim();if(t.length>=best.length&&t.length<1200)best=t}
      out.push({id,url:href.split('?')[0],text:best,title:(a.getAttribute('aria-label')||a.innerText||'').trim()});
    }
    return out;
  }).catch(()=>[]);
}
async function facebookDetailSold(context,row,input){
  const page=await openPage(context,row.url,900);
  try{
    const body=clean(await page.locator('body').innerText().catch(()=>''),30000),html=await page.content().catch(()=>''),lead=body.slice(0,6000);
    const sold=/(?:\"is_sold\":true|is_sold\\\":true)/i.test(html)||(/\bSold\b/i.test(lead)&&!/mark as sold/i.test(lead));
    const price=money(body);
    const identity=input.brand?body.toLowerCase().includes(input.brand.toLowerCase())||overlap(input.title,body.slice(0,5000))>=0.6:overlap(input.title,body.slice(0,5000))>=0.6;
    return {sold,price,identity,text:body.slice(0,1200)};
  }finally{await page.close().catch(()=>{})}
}
export async function collectFacebookSold(context,raw={}){
  const input=normalizedInput(raw),slug=fbSlug(input.location);
  const urls=[
    'https://www.facebook.com/marketplace/'+slug+'/search/?query='+encodeURIComponent(input.query)+'&availability=all',
    'https://www.facebook.com/marketplace/'+slug+'/search/?query='+encodeURIComponent(input.query)+'&availability='+encodeURIComponent('out of stock')
  ];
  let candidates=[],pageUrl='',authenticated=true;
  for(const url of urls){
    const page=await openPage(context,url,2400);
    try{
      pageUrl=page.url();
      const body=clean(await page.locator('body').innerText().catch(()=>''),30000);
      if(/log in to facebook|create new account/i.test(body)&&!/marketplace/i.test(body))authenticated=false;
      const rows=await collectFacebookRows(page);
      const sold=rows.filter(r=>/\bsold\b/i.test(r.text));
      candidates=[...candidates,...(sold.length?sold:rows.slice(0,10))];
      if(sold.length)break;
    }finally{await page.close().catch(()=>{})}
  }
  const dedup=[...new Map(candidates.map(r=>[r.id,r])).values()].slice(0,Math.min(15,input.maxResults));
  const verified=[];
  for(const row of dedup){
    const hint=/\bsold\b/i.test(row.text);
    const d=await facebookDetailSold(context,row,input).catch(()=>({sold:hint,price:money(row.text),identity:overlap(input.title,row.text)>=0.6,text:row.text}));
    if((hint||d.sold)&&d.identity)verified.push({...row,sold_state_verified:true,last_listed_ask:d.price??money(row.text),detail_excerpt:clean(d.text,500)});
    if(verified.length>=input.maxResults)break;
  }
  const asks=verified.map(r=>r.last_listed_ask).filter(Number.isFinite);
  return {
    ok:true,source:'facebook-marketplace-sold-browser',authenticated,sold_state_verified:verified.length>0,query:input.query,query_basis:input.basis,
    sold_marked_count:verified.length,median_last_listed_ask:quantile(asks,.5),p25_last_listed_ask:quantile(asks,.25),
    price_semantics:'Facebook price is the last displayed listing ask, not proof of the negotiated transaction price.',page_url:pageUrl,results:verified.slice(0,20),captured_at:new Date().toISOString()
  };
}
export async function verifyResaleMarkets(context,raw={}){
  const input=normalizedInput(raw);
  const ebay=await collectEbaySold(context,input).catch(error=>({ok:false,source:'ebay-completed-browser',error:clean(error?.message||error,500),results:[]}));
  const facebook=await collectFacebookSold(context,input).catch(error=>({ok:false,source:'facebook-marketplace-sold-browser',error:clean(error?.message||error,500),results:[]}));
  return {ok:Boolean(ebay.ok||facebook.ok),input:{title:input.title,brand:input.brand,gtin:input.gtin,mpn:input.mpn,location:input.location,query:input.query,query_basis:input.basis},ebay,facebook,captured_at:new Date().toISOString()};
}
export const verifierInternals={normalizedInput,money,quantile,overlap,parseSoldDate,shippingAmount};
