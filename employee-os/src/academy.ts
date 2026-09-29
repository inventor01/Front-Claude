import { createHash } from 'node:crypto';
import { pool } from './db.js';

export type VerificationGrade='VERIFIED_FIRST_PARTY'|'VERIFIED_PUBLIC_RECORD'|'CORROBORATED'|'ESTIMATE'|'SIGNAL'|'UNKNOWN';
export type SourceQuality='PLATFORM_DOCS'|'PROVEN_CASE'|'EXPERT_REFERENCE'|'COMMUNITY_TUTORIAL'|'USER_CURATED'|'UNVERIFIED';

export type EmployeeIntelligenceContext={
  profile:{
    firstPrinciples:boolean;
    forwardHorizonSteps:number;
    uncertaintyPolicy:string;
    learningPolicy:string;
    operatingPrinciples:string[];
    verificationPolicy:Record<string,unknown>;
  };
  lessons:Array<{id:string;sourceId:string;title:string;sourceUrl:string|null;sourceQuality:string;lessonType:string;principle:string;applicability:string;confidence:string}>;
};

const DEFAULT_OPERATING_PRINCIPLES=[
  'Start from the desired outcome, constraints, invariants, and unknowns before choosing a tactic.',
  'Do not treat analogy, popularity, or confident language as proof.',
  'When an important fact is unknown, research it instead of silently assuming it.',
  'Prefer primary data, platform documentation, first-party analytics, and reproducible evidence.',
  'Learn from strong operators and proven examples, but preserve the source and test whether the lesson transfers.',
  'Think at least three moves ahead: likely next state, second-order effects, failure modes, and what evidence will resolve uncertainty.',
  'Separate observed fact, estimate, interpretation, hypothesis, and recommendation.',
  'Before a consequential action, identify the claim that matters, the best verification method, and whether the available tool can truly verify it.',
  'After execution, compare expected vs actual results and update lessons rather than defending the original plan.'
];

const DEFAULT_VERIFICATION_POLICY={
  ladder:[
    {grade:'VERIFIED_FIRST_PARTY',meaning:'Direct first-party system of record or audited/owner-controlled data.'},
    {grade:'VERIFIED_PUBLIC_RECORD',meaning:'Authoritative public record or platform-provided observable record.'},
    {grade:'CORROBORATED',meaning:'Multiple independent observable sources agree, but not a first-party system of record.'},
    {grade:'ESTIMATE',meaning:'A modeled or inferred number. Useful for decisions only when explicitly labeled as estimated.'},
    {grade:'SIGNAL',meaning:'Directional evidence such as trend, engagement, ads, or anecdotes.'},
    {grade:'UNKNOWN',meaning:'Insufficient evidence.'}
  ],
  rules:[
    'Never upgrade an estimate into a verified fact.',
    'Revenue, spend, orders, payouts, and customer counts require first-party or authoritative records for VERIFIED status.',
    'Competitor intelligence tools may support ESTIMATE or CORROBORATED status depending on methodology; they do not become first-party truth.',
    'External tutorial content is training material, not company fact.',
    'If the ideal verification tool is unavailable, state the blocker and choose the strongest valid fallback rather than inventing certainty.'
  ]
};

const SEED_TOOLS=[
  {
    toolId:'shopify-analytics',name:'Shopify Analytics / Reports',provider:'SHOPIFY',capability:'OWN_STORE_REVENUE_ORDERS_CONVERSION',
    verificationGrade:'VERIFIED_FIRST_PARTY',automationPolicy:'CONNECTED_API_ONLY',sourceUrl:'https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports',
    metadata:{bestFor:['own Shopify revenue','orders','conversion','product sales'],limitations:['Requires authorized access to the merchant store.']}
  },
  {
    toolId:'stripe',name:'Stripe',provider:'STRIPE',capability:'OWN_PAYMENT_REVENUE_PAYOUTS',
    verificationGrade:'VERIFIED_FIRST_PARTY',automationPolicy:'CONNECTED_API_ONLY',sourceUrl:'https://docs.stripe.com/reports',
    metadata:{bestFor:['payments','refunds','payouts','net payment revenue'],limitations:['Only covers transactions processed through the connected Stripe account.']}
  },
  {
    toolId:'shophunter',name:'ShopHunter',provider:'SHOPHUNTER',capability:'COMPETITOR_SHOPIFY_REVENUE_ESTIMATE_PRODUCT_RESEARCH',
    verificationGrade:'ESTIMATE',automationPolicy:'AUTHORIZED_API_OR_MANUAL_ONLY',sourceUrl:'https://www.shophunter.io/',
    metadata:{
      bestFor:['competitor Shopify revenue estimates','estimated order volume','product discovery','ad activity'],
      limitations:['Revenue and orders are estimates based on public signals, not merchant-side audited revenue.','Do not label ShopHunter output as exact verified competitor revenue.'],
      termsNote:'Use only through an authorized API/integration or manual workflow consistent with provider terms; do not scrape the authenticated product.'
    }
  },
  {
    toolId:'similarweb',name:'Similarweb',provider:'SIMILARWEB',capability:'COMPETITOR_TRAFFIC_ESTIMATE',
    verificationGrade:'ESTIMATE',automationPolicy:'AUTHORIZED_API_OR_MANUAL_ONLY',sourceUrl:'https://www.similarweb.com/',
    metadata:{bestFor:['traffic estimates','channel mix estimates'],limitations:['Modeled traffic data is not the site owner\'s first-party analytics.']}
  },
  {
    toolId:'meta-ad-library',name:'Meta Ad Library',provider:'META',capability:'AD_ACTIVITY_CREATIVE_OBSERVATION',
    verificationGrade:'VERIFIED_PUBLIC_RECORD',automationPolicy:'PUBLIC_OR_AUTHORIZED_API',sourceUrl:'https://www.facebook.com/ads/library/',
    metadata:{bestFor:['whether ads are publicly visible','creative observation'],limitations:['Does not prove revenue or profitability.']}
  },
  {
    toolId:'tiktok-creative-center',name:'TikTok Creative Center',provider:'TIKTOK',capability:'CREATIVE_TREND_AD_SIGNAL',
    verificationGrade:'SIGNAL',automationPolicy:'PUBLIC_OR_AUTHORIZED_API',sourceUrl:'https://ads.tiktok.com/business/creativecenter/',
    metadata:{bestFor:['creative patterns','trend signals','ad inspiration'],limitations:['Trend/creative signal does not prove unit economics or revenue.']}
  },
  {
    toolId:'google-trends',name:'Google Trends',provider:'GOOGLE',capability:'SEARCH_INTEREST_TREND',
    verificationGrade:'SIGNAL',automationPolicy:'PUBLIC_OR_AUTHORIZED_API',sourceUrl:'https://trends.google.com/',
    metadata:{bestFor:['relative search interest','seasonality direction'],limitations:['Relative interest is not sales volume.']}
  },
  {
    toolId:'jina-search',name:'Jina Search',provider:'JINA',capability:'WEB_TOOL_DISCOVERY_RESEARCH',
    verificationGrade:'SIGNAL',automationPolicy:'API_KEY_REQUIRED',sourceUrl:'https://jina.ai/',
    metadata:{bestFor:['finding candidate tools','discovering documentation and providers'],limitations:['Search results identify candidates; tool capability must still be verified from primary documentation.']}
  }
] as const;

function isPrivateHost(host:string){
  const h=host.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')||h==='::1')return true;
  if(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h))return true;
  const m=h.match(/^172\.(\d+)\./); if(m&&Number(m[1])>=16&&Number(m[1])<=31)return true;
  if(/^169\.254\./.test(h))return true;
  return false;
}

function normalizedPublicUrl(value:string){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw new Error('Training URLs must use http or https.');
  if(isPrivateHost(url.hostname))throw new Error('Private/local training URLs are not allowed.');
  return url;
}

function inferSourceType(url:string|null){
  if(!url)return 'NOTE';
  const host=new URL(url).hostname.toLowerCase();
  if(host==='x.com'||host.endsWith('.x.com')||host==='twitter.com'||host.endsWith('.twitter.com'))return 'X_THREAD';
  if(host.includes('youtube.com')||host==='youtu.be')return 'VIDEO';
  return 'URL';
}

function inferSourceQuality(url:string|null,raw:string):SourceQuality{
  if(!url)return 'USER_CURATED';
  const host=new URL(url).hostname.toLowerCase();
  if(host.includes('help.shopify.com')||host.includes('docs.')||host.includes('developer.')||host.includes('developers.')||host==='jina.ai')return 'PLATFORM_DOCS';
  if(host==='x.com'||host.endsWith('.x.com')||host.includes('youtube.com')||host==='youtu.be'||host.includes('reddit.com'))return 'COMMUNITY_TUTORIAL';
  if(/case study|results|measured|before and after|revenue|conversion|retention/i.test(raw))return 'PROVEN_CASE';
  return 'UNVERIFIED';
}

async function fetchPublicSource(urlValue:string){
  const url=normalizedPublicUrl(urlValue);
  const reader=`https://r.jina.ai/${url.href}`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetch(reader,{headers:{'user-agent':'AI-Employee-OS-Academy/0.3'},signal:controller.signal});
    if(!response.ok)throw new Error(`Could not read training source (HTTP ${response.status}).`);
    return (await response.text()).slice(0,180_000);
  }finally{clearTimeout(timer);}
}

function lessonCandidates(raw:string){
  const lines=raw.split(/\n+/)
    .map((line)=>line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,'').replace(/^#+\s*/,'').trim())
    .filter((line)=>line.length>=35&&line.length<=600)
    .filter((line)=>!/^(image|source|title|url|published time|markdown content)\s*:/i.test(line));
  const scored=lines.map((line)=>{
    let score=0;
    if(/\b(always|never|should|must|avoid|prefer|instead|because|when|before|after|first|then|step|framework|rule|principle|workflow|test|measure|verify|hook|shot|camera|motion|lighting|prompt|edit|retention)\b/i.test(line))score+=3;
    if(/[.:;]/.test(line))score+=1;
    if(line.split(/\s+/).length>=8)score+=1;
    return {line,score};
  }).filter((x)=>x.score>=3);
  const seen=new Set<string>();
  return scored.sort((a,b)=>b.score-a.score).filter((x)=>{
    const key=x.line.toLowerCase().replace(/[^a-z0-9]+/g,' ').slice(0,140);
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,20).map((x)=>x.line);
}

function lessonType(line:string){
  if(/\b(step|first|then|next|workflow|process|sequence)\b/i.test(line))return 'WORKFLOW';
  if(/\b(always|never|should|must|principle|rule|because)\b/i.test(line))return 'PRINCIPLE';
  if(/\b(test|hook|shot|camera|prompt|edit|lighting|motion)\b/i.test(line))return 'TACTIC';
  return 'REFERENCE';
}

function confidenceForQuality(quality:SourceQuality){
  if(quality==='PLATFORM_DOCS')return 'HIGH';
  if(quality==='PROVEN_CASE'||quality==='EXPERT_REFERENCE')return 'MEDIUM';
  return 'LOW';
}

export async function ensureAcademyDefaults(companyId:string){
  const employees=await pool.query('SELECT slug FROM employees WHERE company_id=$1',[companyId]);
  for(const row of employees.rows){
    await pool.query(`INSERT INTO reasoning_profiles(
      company_id,employee_slug,first_principles,forward_horizon_steps,uncertainty_policy,learning_policy,operating_principles,verification_policy
    ) VALUES($1,$2,true,3,'NEVER_ASSUME','LEARN_FROM_BEST_AVAILABLE_EVIDENCE',$3,$4)
    ON CONFLICT(company_id,employee_slug) DO NOTHING`,[
      companyId,row.slug,JSON.stringify(DEFAULT_OPERATING_PRINCIPLES),JSON.stringify(DEFAULT_VERIFICATION_POLICY)
    ]);
  }
  for(const tool of SEED_TOOLS){
    await pool.query(`INSERT INTO tool_catalog(
      company_id,tool_id,name,provider,capability,verification_grade,automation_policy,source_url,status,metadata,discovered_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AVAILABLE',$9,'SYSTEM_SEED')
    ON CONFLICT(company_id,tool_id) DO UPDATE SET
      name=EXCLUDED.name,provider=EXCLUDED.provider,capability=EXCLUDED.capability,
      verification_grade=EXCLUDED.verification_grade,automation_policy=EXCLUDED.automation_policy,
      source_url=EXCLUDED.source_url,metadata=EXCLUDED.metadata,updated_at=now()`,[
      companyId,tool.toolId,tool.name,tool.provider,tool.capability,tool.verificationGrade,tool.automationPolicy,tool.sourceUrl,JSON.stringify(tool.metadata)
    ]);
  }
}

export async function ingestTrainingSource(input:{
  companyId:string;userId:string;employeeSlug:string|null;url?:string;text?:string;title?:string;tags?:string[];
}){
  await ensureAcademyDefaults(input.companyId);
  if(input.employeeSlug){
    const employee=await pool.query('SELECT 1 FROM employees WHERE company_id=$1 AND slug=$2',[input.companyId,input.employeeSlug]);
    if(!employee.rowCount)throw new Error('Employee not found.');
  }
  const sourceUrl=input.url?.trim()||null;
  const suppliedText=input.text?.trim()||'';
  let fetched='';
  if(sourceUrl&&!suppliedText){
    try{
      fetched=await fetchPublicSource(sourceUrl);
    }catch(error){
      const host=new URL(sourceUrl).hostname.toLowerCase();
      if(host==='x.com'||host.endsWith('.x.com')||host==='twitter.com'||host.endsWith('.twitter.com')){
        const message=error instanceof Error?error.message:'X source could not be read';
        throw new Error(`${message} X may block automated readers; paste the thread/article text with the original X URL and Employee OS will preserve the X source as provenance.`);
      }
      throw error;
    }
  }
  const raw=(suppliedText||fetched).slice(0,180_000);
  if(raw.length<20)throw new Error('Training source did not contain enough readable content.');
  const type=inferSourceType(sourceUrl);
  const quality=inferSourceQuality(sourceUrl,raw);
  const title=(input.title?.trim()||raw.match(/^Title:\s*(.+)$/mi)?.[1]?.trim()||sourceUrl||'Training note').slice(0,240);
  const source=await pool.query(`INSERT INTO training_sources(
    company_id,employee_slug,source_type,title,source_url,raw_content,source_quality,status,tags,ingest_metadata,created_by
  ) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9,$10) RETURNING *`,[
    input.companyId,input.employeeSlug,type,title,sourceUrl,raw,quality,JSON.stringify(input.tags||[]),
    JSON.stringify({reader:sourceUrl?'JINA_READER':'DIRECT_TEXT',fetchedAt:new Date().toISOString(),contentChars:raw.length}),input.userId
  ]);

  const candidates=lessonCandidates(raw);
  const confidence=confidenceForQuality(quality);
  const lessons=[];
  for(const principle of candidates){
    const r=await pool.query(`INSERT INTO training_lessons(
      company_id,source_id,employee_slug,lesson_type,principle,applicability,confidence,status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE') RETURNING *`,[
      input.companyId,source.rows[0].id,input.employeeSlug,lessonType(principle),principle,
      input.employeeSlug?`Apply when ${input.employeeSlug} is doing relevant work; verify transfer before treating it as a proven company rule.`:
        'Potentially company-wide; apply only when relevant and verify transfer before treating it as a proven rule.',
      confidence
    ]);
    lessons.push(r.rows[0]);
  }
  await pool.query(`INSERT INTO events(company_id,type,payload) VALUES($1,'TRAINING_SOURCE_INGESTED',$2)`,[
    input.companyId,JSON.stringify({sourceId:source.rows[0].id,employeeSlug:input.employeeSlug,sourceType:type,sourceQuality:quality,lessonCount:lessons.length})
  ]);
  return {source:source.rows[0],lessons};
}

export async function getEmployeeIntelligenceContext(companyId:string,employeeSlug:string):Promise<EmployeeIntelligenceContext>{
  await ensureAcademyDefaults(companyId);
  const [profile,lessons]=await Promise.all([
    pool.query(`SELECT * FROM reasoning_profiles WHERE company_id=$1 AND employee_slug=$2`,[companyId,employeeSlug]),
    pool.query(`SELECT l.id,l.source_id,l.lesson_type,l.principle,l.applicability,l.confidence,
      s.title,s.source_url,s.source_quality
      FROM training_lessons l JOIN training_sources s ON s.id=l.source_id
      WHERE l.company_id=$1 AND l.status='ACTIVE' AND s.status='ACTIVE'
      AND (l.employee_slug=$2 OR l.employee_slug IS NULL)
      ORDER BY CASE WHEN l.employee_slug=$2 THEN 0 ELSE 1 END,
        CASE l.confidence WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,l.created_at DESC
      LIMIT 24`,[companyId,employeeSlug])
  ]);
  const p=profile.rows[0];
  return {
    profile:{
      firstPrinciples:p?.first_principles!==false,
      forwardHorizonSteps:Number(p?.forward_horizon_steps||3),
      uncertaintyPolicy:String(p?.uncertainty_policy||'NEVER_ASSUME'),
      learningPolicy:String(p?.learning_policy||'LEARN_FROM_BEST_AVAILABLE_EVIDENCE'),
      operatingPrinciples:Array.isArray(p?.operating_principles)?p.operating_principles:DEFAULT_OPERATING_PRINCIPLES,
      verificationPolicy:(p?.verification_policy&&typeof p.verification_policy==='object')?p.verification_policy:DEFAULT_VERIFICATION_POLICY
    },
    lessons:lessons.rows.map((row)=>({
      id:String(row.id),sourceId:String(row.source_id),title:String(row.title),sourceUrl:row.source_url?String(row.source_url):null,
      sourceQuality:String(row.source_quality),lessonType:String(row.lesson_type),principle:String(row.principle),
      applicability:String(row.applicability),confidence:String(row.confidence)
    }))
  };
}

function gradeRank(grade:string){
  return ({VERIFIED_FIRST_PARTY:6,VERIFIED_PUBLIC_RECORD:5,CORROBORATED:4,ESTIMATE:3,SIGNAL:2,UNKNOWN:1} as Record<string,number>)[grade]||0;
}

function capabilityMatch(claimType:string,capability:string){
  const q=claimType.toUpperCase();
  if(q.includes('OWN_REVENUE'))return /OWN_.*REVENUE|PAYMENT_REVENUE/.test(capability);
  if(q.includes('COMPETITOR_REVENUE'))return /COMPETITOR_.*REVENUE/.test(capability);
  if(q.includes('TRAFFIC'))return /TRAFFIC/.test(capability);
  if(q.includes('AD'))return /AD_ACTIVITY|CREATIVE_TREND/.test(capability);
  if(q.includes('TREND'))return /TREND|SEARCH_INTEREST/.test(capability);
  return capability.includes(q.replace(/[^A-Z0-9]+/g,'_'));
}

export async function recommendVerificationTools(companyId:string,claimType:string){
  await ensureAcademyDefaults(companyId);
  const r=await pool.query('SELECT * FROM tool_catalog WHERE company_id=$1 AND status IN (\'AVAILABLE\',\'CONNECTED\',\'DISCOVERED\')',[companyId]);
  return r.rows
    .filter((row)=>capabilityMatch(claimType,String(row.capability)))
    .sort((a,b)=>gradeRank(String(b.verification_grade))-gradeRank(String(a.verification_grade)));
}

export async function discoverTools(companyId:string,claimType:string,claimDescription:string){
  await ensureAcademyDefaults(companyId);
  const existing=await recommendVerificationTools(companyId,claimType);
  const key=process.env.JINA_API_KEY||'';
  const run=await pool.query(`INSERT INTO tool_discovery_runs(company_id,claim_type,query,status,results)
    VALUES($1,$2,$3,$4,'[]'::jsonb) RETURNING *`,[
    companyId,claimType,`${claimDescription} verification tools`,key?'RUNNING':'AUTH_REQUIRED'
  ]);
  if(!key){
    return {run:run.rows[0],webSearchStatus:'AUTH_REQUIRED',recommended:existing,discovered:[]};
  }
  try{
    const query=`best tools or official data sources to verify ${claimType}: ${claimDescription}. Prefer first-party APIs, official platform analytics, authoritative public records, and documented methodologies.`;
    const response=await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`,{
      headers:{authorization:`Bearer ${key}`,accept:'application/json','user-agent':'AI-Employee-OS-Academy/0.3'}
    });
    if(!response.ok)throw new Error(`Jina Search HTTP ${response.status}`);
    const body=await response.json() as unknown;
    const items=Array.isArray(body)?body:(typeof body==='object'&&body!==null&&'data' in body&&Array.isArray((body as {data?:unknown}).data)?(body as {data:unknown[]}).data:[]);
    const discovered=[];
    for(const item of items.slice(0,8)){
      if(typeof item!=='object'||item===null)continue;
      const obj=item as Record<string,unknown>;
      const url=String(obj.url||obj.link||'').trim(); if(!url)continue;
      const title=String(obj.title||new URL(url).hostname).slice(0,200);
      const description=String(obj.description||obj.content||'').slice(0,1200);
      const hash=createHash('sha256').update(url).digest('hex').slice(0,16);
      const toolId=`discovered-${hash}`;
      const r=await pool.query(`INSERT INTO tool_catalog(
        company_id,tool_id,name,provider,capability,verification_grade,automation_policy,source_url,status,metadata,discovered_by
      ) VALUES($1,$2,$3,$4,$5,'UNKNOWN','REVIEW_REQUIRED',$6,'DISCOVERED',$7,'TOOL_SCOUT')
      ON CONFLICT(company_id,tool_id) DO UPDATE SET name=EXCLUDED.name,source_url=EXCLUDED.source_url,metadata=EXCLUDED.metadata,updated_at=now()
      RETURNING *`,[
        companyId,toolId,title,new URL(url).hostname.toUpperCase(),claimType.toUpperCase(),url,
        JSON.stringify({searchDescription:description,discoveryQuery:query,warning:'Discovered candidate only. Verify official capabilities, methodology, terms, and API access before use.'})
      ]);
      discovered.push(r.rows[0]);
    }
    await pool.query('UPDATE tool_discovery_runs SET status=\'DONE\',results=$2,updated_at=now() WHERE id=$1',[
      run.rows[0].id,JSON.stringify(discovered.map((x)=>({toolId:x.tool_id,name:x.name,sourceUrl:x.source_url})))
    ]);
    return {run:{...run.rows[0],status:'DONE'},webSearchStatus:'DONE',recommended:[...existing,...discovered],discovered};
  }catch(error){
    const message=error instanceof Error?error.message:'Tool discovery failed';
    await pool.query('UPDATE tool_discovery_runs SET status=\'FAILED\',error=$2,updated_at=now() WHERE id=$1',[run.rows[0].id,message]);
    return {run:{...run.rows[0],status:'FAILED',error:message},webSearchStatus:'FAILED',recommended:existing,discovered:[]};
  }
}
