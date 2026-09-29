export type ShopifyGraph = <T>(query:string,variables?:Record<string,unknown>)=>Promise<T>;

function safeHex(value:unknown,fallback:string){
  const v=String(value||'').trim();
  if(/^#[0-9a-f]{6}$/i.test(v))return v;
  if(/^#[0-9a-f]{3}$/i.test(v))return '#'+v.slice(1).split('').map((x)=>x+x).join('');
  const named:Record<string,string>={black:'#0a0a0a',white:'#ffffff',cream:'#f5f0e8',beige:'#e8ddcc',tan:'#d8c3a5',gray:'#737373',grey:'#737373',blue:'#315bff',navy:'#111a3a',red:'#df3b33',green:'#2f7d55',orange:'#ef7c2f',yellow:'#f1c232',pink:'#e86a92',purple:'#6e4bd3',brown:'#6d4c41'};
  const lower=v.toLowerCase();
  for(const [name,hex] of Object.entries(named))if(lower.includes(name))return hex;
  return fallback;
}

function designFromPackage(pkg:Record<string,unknown>,productHandle:string,title:string){
  const brand=(pkg.brand_direction&&typeof pkg.brand_direction==='object')?pkg.brand_direction as Record<string,unknown>:{};
  const palette=Array.isArray(brand.palette)?brand.palette.map(String):[];
  const working=Array.isArray(brand.workingNameOptions)?brand.workingNameOptions.map(String):[];
  return {
    background:safeHex(palette[0],'#f6f3ed'),
    foreground:safeHex(palette[1],'#111111'),
    accent:safeHex(palette[2],'#ff5a36'),
    brandName:(working[0]||title).slice(0,80),
    typographyMood:String(brand.typographyMood||'bold modern sans-serif').slice(0,120),
    layoutMood:String(brand.layoutMood||'mobile-first product demonstration').slice(0,120),
    productHandle
  };
}

function eosCss(){return [
  '.eos-root{--eos-bg:#f6f3ed;--eos-fg:#111;--eos-accent:#ff5a36;background:var(--eos-bg);color:var(--eos-fg)}',
  '.eos-wrap{max-width:1180px;margin:0 auto;padding:clamp(28px,5vw,72px) 20px}',
  '.eos-hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:clamp(24px,5vw,72px);align-items:center;min-height:70vh}',
  '.eos-kicker{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;opacity:.65}',
  '.eos-title{font-size:clamp(42px,7vw,88px);line-height:.94;letter-spacing:-.055em;margin:12px 0 20px}',
  '.eos-copy{font-size:clamp(16px,2vw,20px);line-height:1.55;max-width:620px;opacity:.78}',
  '.eos-price{font-size:24px;font-weight:800;margin:22px 0}',
  '.eos-btn{display:inline-flex;justify-content:center;align-items:center;background:var(--eos-accent);color:#fff;border:0;border-radius:999px;padding:15px 24px;font-weight:800;text-decoration:none;min-height:50px}',
  '.eos-media{border-radius:28px;overflow:hidden;background:#ddd;aspect-ratio:1/1;box-shadow:0 24px 70px rgba(0,0,0,.15)}',
  '.eos-media img{width:100%;height:100%;object-fit:cover;display:block}',
  '.eos-proof{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:42px}',
  '.eos-proof article{border:1px solid rgba(20,20,20,.14);border-radius:18px;padding:20px;background:rgba(255,255,255,.38)}',
  '.eos-proof h3{font-size:15px;margin:0 0 7px}.eos-proof p{font-size:13px;line-height:1.5;margin:0;opacity:.68}',
  '.eos-band{background:var(--eos-fg);color:var(--eos-bg)}.eos-band .eos-wrap{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}',
  '.eos-band h2{font-size:clamp(32px,5vw,64px);letter-spacing:-.045em;line-height:1;margin:0}.eos-band p{opacity:.75;line-height:1.7}',
  '.eos-product-shell{max-width:1180px;margin:0 auto;padding:40px 20px 80px;display:grid;grid-template-columns:1fr 1fr;gap:50px}',
  '.eos-product-copy h1{font-size:clamp(38px,5vw,68px);letter-spacing:-.045em;line-height:1;margin:12px 0}',
  '.eos-product-copy ul{padding-left:20px;line-height:1.8}.eos-form select,.eos-form input{width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;margin-bottom:10px}',
  '.eos-faq{max-width:900px;margin:0 auto;padding:20px 20px 80px}.eos-faq details{border-top:1px solid #ddd;padding:18px 0}.eos-faq summary{font-weight:750;cursor:pointer}',
  '@media(max-width:760px){.eos-hero,.eos-band .eos-wrap,.eos-product-shell{grid-template-columns:1fr}.eos-hero{min-height:auto}.eos-proof{grid-template-columns:1fr}.eos-media{order:-1}.eos-title{font-size:clamp(40px,13vw,64px)}}'
].join('\n');}

function homeSection(){return [
  "{{ 'eos.css' | asset_url | stylesheet_tag }}",
  "{% assign featured_product = all_products[section.settings.product_handle] %}",
  '<section class="eos-root" style="--eos-bg:{{ section.settings.background }};--eos-fg:{{ section.settings.foreground }};--eos-accent:{{ section.settings.accent }}">',
  '  <div class="eos-wrap"><div class="eos-hero"><div>',
  '    <div class="eos-kicker">{{ section.settings.brand_name }}</div>',
  '    <h1 class="eos-title">{{ section.settings.headline }}</h1>',
  '    <p class="eos-copy">{{ section.settings.subheadline }}</p>',
  '    {% if featured_product != blank %}<div class="eos-price">{{ featured_product.price | money }}</div><a class="eos-btn" href="{{ featured_product.url }}">See the product</a>{% endif %}',
  '  </div><div class="eos-media">{% if featured_product.featured_image %}{{ featured_product.featured_image | image_url: width: 1400 | image_tag: loading: \"eager\", alt: featured_product.title }}{% else %}{{ \"product-1\" | placeholder_svg_tag }}{% endif %}</div></div>',
  '  <div class="eos-proof">{% for block in section.blocks %}<article {{ block.shopify_attributes }}><h3>{{ block.settings.title }}</h3><p>{{ block.settings.text }}</p></article>{% endfor %}</div></div>',
  '  <div class="eos-band"><div class="eos-wrap"><h2>{{ section.settings.band_heading }}</h2><p>{{ section.settings.band_text }}</p></div></div>',
  '</section>',
  '{% schema %}',
  JSON.stringify({name:'Employee OS venture home',settings:[
    {type:'text',id:'brand_name',label:'Brand',default:'Venture'},
    {type:'text',id:'headline',label:'Headline',default:'See the product. Understand the difference.'},
    {type:'textarea',id:'subheadline',label:'Subheadline',default:'A clear product-first experience built around the demonstrated use case.'},
    {type:'product',id:'product_handle',label:'Featured product'},
    {type:'color',id:'background',label:'Background',default:'#f6f3ed'},
    {type:'color',id:'foreground',label:'Text',default:'#111111'},
    {type:'color',id:'accent',label:'Accent',default:'#ff5a36'},
    {type:'text',id:'band_heading',label:'Band heading',default:'See what it does before you decide.'},
    {type:'textarea',id:'band_text',label:'Band text',default:'Product details stay grounded in what can be demonstrated and verified.'}
  ],blocks:[{type:'proof',name:'Proof point',settings:[{type:'text',id:'title',label:'Title'},{type:'textarea',id:'text',label:'Text'}]}],presets:[{name:'Employee OS venture home'}]}),
  '{% endschema %}'
].join('\n');}

function productSection(){return [
  "{{ 'eos.css' | asset_url | stylesheet_tag }}",
  '<section class="eos-root" style="--eos-bg:{{ section.settings.background }};--eos-fg:{{ section.settings.foreground }};--eos-accent:{{ section.settings.accent }}">',
  '  <div class="eos-product-shell"><div class="eos-media">{% if product.featured_image %}{{ product.featured_image | image_url: width: 1400 | image_tag: loading: \"eager\", alt: product.title }}{% endif %}</div>',
  '  <div class="eos-product-copy"><div class="eos-kicker">{{ section.settings.brand_name }}</div><h1>{{ product.title }}</h1><div class="eos-price">{{ product.selected_or_first_available_variant.price | money }}</div><div class="eos-copy">{{ product.description }}</div>',
  "  {% form 'product', product, class: 'eos-form' %}<input type=\"hidden\" name=\"id\" value=\"{{ product.selected_or_first_available_variant.id }}\"><button class=\"eos-btn\" type=\"submit\" {% unless product.available %}disabled{% endunless %}>{% if product.available %}Add to cart{% else %}Sold out{% endif %}</button>{% endform %}",
  '  <ul><li>Verified supplier mapping before publication</li><li>Shipping expectations stay evidence-based</li><li>No invented testimonials or performance claims</li></ul></div></div>',
  '  <div class="eos-faq"><h2>Before you buy</h2><details><summary>What should I know about shipping?</summary><p>Delivery timing depends on destination and the verified fulfillment method shown at checkout or in order communication.</p></details><details><summary>What if I have a compatibility question?</summary><p>Contact support before ordering if your setup has a specific compatibility requirement.</p></details><details><summary>What is the return policy?</summary><p>Return eligibility follows the store policy and order condition. Check the policy page for the current terms.</p></details></div>',
  '</section>',
  '{% schema %}',
  JSON.stringify({name:'Employee OS product',settings:[
    {type:'text',id:'brand_name',label:'Brand',default:'Venture'},
    {type:'color',id:'background',label:'Background',default:'#f6f3ed'},
    {type:'color',id:'foreground',label:'Text',default:'#111111'},
    {type:'color',id:'accent',label:'Accent',default:'#ff5a36'}
  ],presets:[{name:'Employee OS product'}]}),
  '{% endschema %}'
].join('\n');}

async function waitThemeReady(graph:ShopifyGraph,themeId:string){
  for(let i=0;i<30;i++){
    const data=await graph<{theme:{id:string;name:string;role:string;processing:boolean}|null}>('query ThemeReady($id:ID!){theme(id:$id){id name role processing}}',{id:themeId});
    if(data.theme&&!data.theme.processing)return data.theme;
    await new Promise((resolve)=>setTimeout(resolve,1000));
  }
  throw new Error('Shopify theme copy did not become ready in time.');
}
async function waitGraphJob(graph:ShopifyGraph,jobId:string){
  for(let i=0;i<40;i++){
    const data=await graph<{node:{id:string;done:boolean}|null}>('query ThemeFileJob($id:ID!){node(id:$id){... on Job{id done}}}',{id:jobId});
    if(data.node?.done)return;
    await new Promise((resolve)=>setTimeout(resolve,750));
  }
  throw new Error('Shopify theme-file write job did not complete in time.');
}

export async function buildAndPublishTheme(graph:ShopifyGraph,pkg:Record<string,unknown>,productHandle:string,title:string){
  const mains=await graph<{themes:{nodes:Array<{id:string;name:string;role:string;processing:boolean}>}}>('query MainTheme{themes(first:10,roles:[MAIN]){nodes{id name role processing}}}');
  const main=mains.themes.nodes[0];
  if(!main)throw new Error('Shopify main theme was not found.');
  const design=designFromPackage(pkg,productHandle,title);
  const duplicate=await graph<{themeDuplicate:{newTheme:{id:string;name:string;role:string;processing:boolean}|null;userErrors:Array<{field:string[];message:string}>}}>(
    'mutation DuplicateTheme($id:ID!,$name:String){themeDuplicate(id:$id,name:$name){newTheme{id name role processing} userErrors{field message}}}',
    {id:main.id,name:('Employee OS – '+title).slice(0,50)});
  if(duplicate.themeDuplicate.userErrors.length)throw new Error('Shopify theme duplicate error: '+duplicate.themeDuplicate.userErrors.map((e)=>e.message).join('; '));
  if(!duplicate.themeDuplicate.newTheme)throw new Error('Shopify did not return a duplicated theme.');
  const draft=await waitThemeReady(graph,duplicate.themeDuplicate.newTheme.id);

  const homeTemplate={sections:{main:{type:'eos-home',settings:{
    brand_name:design.brandName,headline:title,subheadline:'A focused product experience built around a clear, demonstrated use case.',
    product_handle:design.productHandle,background:design.background,foreground:design.foreground,accent:design.accent,
    band_heading:'See what it does before you decide.',band_text:'Visual direction: '+design.layoutMood+'. Product claims remain evidence-gated.'
  },blocks:{
    proof1:{type:'proof',settings:{title:'Clear use case',text:'The product is explained through its demonstrated job, not vague hype.'}},
    proof2:{type:'proof',settings:{title:'Verified fulfillment',text:'Supplier stock, freight, and landed cost are checked before publication.'}},
    proof3:{type:'proof',settings:{title:'Straightforward support',text:'Questions and exceptions are handled without inventing facts.'}}
  },block_order:['proof1','proof2','proof3']}},order:['main']};
  const productTemplate={sections:{main:{type:'eos-product',settings:{brand_name:design.brandName,background:design.background,foreground:design.foreground,accent:design.accent}}},order:['main']};
  const files=[
    {filename:'assets/eos.css',body:{type:'TEXT',value:eosCss()}},
    {filename:'sections/eos-home.liquid',body:{type:'TEXT',value:homeSection()}},
    {filename:'sections/eos-product.liquid',body:{type:'TEXT',value:productSection()}},
    {filename:'templates/index.json',body:{type:'TEXT',value:JSON.stringify(homeTemplate)}},
    {filename:'templates/product.json',body:{type:'TEXT',value:JSON.stringify(productTemplate)}}
  ];
  const upsert=await graph<{themeFilesUpsert:{job:{id:string;done:boolean}|null;userErrors:Array<{filename:string;message:string}>}}>(
    'mutation WriteVentureTheme($themeId:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$themeId,files:$files){job{id done} userErrors{filename message}}}',
    {themeId:draft.id,files});
  if(upsert.themeFilesUpsert.userErrors.length)throw new Error('Shopify theme write error: '+upsert.themeFilesUpsert.userErrors.map((e)=>e.message).join('; '));
  if(upsert.themeFilesUpsert.job&&!upsert.themeFilesUpsert.job.done)await waitGraphJob(graph,upsert.themeFilesUpsert.job.id);
  const publish=await graph<{themePublish:{theme:{id:string;name:string;role:string}|null;userErrors:Array<{field:string[];message:string}>}}>(
    'mutation PublishVentureTheme($id:ID!){themePublish(id:$id){theme{id name role} userErrors{field message}}}',{id:draft.id});
  if(publish.themePublish.userErrors.length)throw new Error('Shopify theme publish error: '+publish.themePublish.userErrors.map((e)=>e.message).join('; '));
  if(!publish.themePublish.theme)throw new Error('Shopify did not return the published theme.');
  return {themeId:publish.themePublish.theme.id,themeName:publish.themePublish.theme.name,design,previousThemeId:main.id};
}
