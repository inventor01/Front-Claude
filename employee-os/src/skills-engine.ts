import { pool } from './db.js';

function slugify(value:string){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||`skill-${Date.now()}`;
}

function toolHints(text:string){
  const v=text.toLowerCase(), tools:string[]=[];
  if(/video|render|camera|shot|clip|seedance|runway/.test(v))tools.push('creative-renderer');
  if(/shopify|store|product page|checkout/.test(v))tools.push('shopify-admin');
  if(/revenue|sales|orders|verify|analytics/.test(v))tools.push('verification-tool');
  if(/tiktok|instagram|publish|post/.test(v))tools.push('social-publisher');
  return [...new Set(tools)];
}

export async function compileSkill(input:{
  companyId:string;userId:string;employeeSlug:string|null;name:string;purpose:string;sourceIds:string[];
}){
  const sourceFilter=input.sourceIds.length?'AND s.id = ANY($3::uuid[])':'';
  const params=input.sourceIds.length?[input.companyId,input.employeeSlug,input.sourceIds]:[input.companyId,input.employeeSlug];
  const r=await pool.query(`SELECT l.*,s.title source_title,s.source_url,s.source_quality
    FROM training_lessons l JOIN training_sources s ON s.id=l.source_id
    WHERE l.company_id=$1 AND l.status='ACTIVE' AND s.status='ACTIVE'
      AND (l.employee_slug=$2 OR l.employee_slug IS NULL) ${sourceFilter}
    ORDER BY CASE l.lesson_type WHEN 'WORKFLOW' THEN 0 WHEN 'PRINCIPLE' THEN 1 WHEN 'TACTIC' THEN 2 ELSE 3 END,l.created_at`,params);
  if(!r.rowCount)throw new Error('No active sourced lessons were found for this skill.');

  const lessons=r.rows;
  const steps=lessons.map((lesson,index)=>({
    order:index+1,
    type:lesson.lesson_type,
    instruction:String(lesson.principle),
    sourceLessonId:String(lesson.id),
    sourceTitle:String(lesson.source_title),
    sourceQuality:String(lesson.source_quality),
    verifyBeforePromotion:lesson.source_quality!=='PLATFORM_DOCS'
  }));
  const requiredTools=toolHints(`${input.name} ${input.purpose} ${steps.map((s)=>s.instruction).join(' ')}`);
  const successCriteria=[
    'All procedure steps preserve source provenance.',
    'Unknown claims are labeled and verified before consequential action.',
    'External side effects use connected authorized tools only.',
    'Expected result is compared with actual result and the skill is updated when evidence contradicts it.'
  ];
  const slug=slugify(input.name);
  const existing=await pool.query('SELECT * FROM skill_definitions WHERE company_id=$1 AND slug=$2',[input.companyId,slug]);
  let definition,version:number;
  if(existing.rowCount){
    definition=existing.rows[0];
    version=Number(definition.current_version||1)+1;
    await pool.query(`UPDATE skill_definitions SET employee_slug=$3,name=$4,purpose=$5,current_version=$6,
      source_ids=$7,required_tools=$8,success_criteria=$9,status='DRAFT',updated_at=now() WHERE id=$1 AND company_id=$2`,[
      definition.id,input.companyId,input.employeeSlug,input.name,input.purpose,version,
      JSON.stringify([...new Set(lessons.map((x)=>x.source_id))]),JSON.stringify(requiredTools),JSON.stringify(successCriteria)
    ]);
  }else{
    const d=await pool.query(`INSERT INTO skill_definitions(
      company_id,employee_slug,slug,name,purpose,status,current_version,source_ids,required_tools,success_criteria,created_by
    ) VALUES($1,$2,$3,$4,$5,'DRAFT',1,$6,$7,$8,$9) RETURNING *`,[
      input.companyId,input.employeeSlug,slug,input.name,input.purpose,
      JSON.stringify([...new Set(lessons.map((x)=>x.source_id))]),JSON.stringify(requiredTools),JSON.stringify(successCriteria),input.userId
    ]);
    definition=d.rows[0];version=1;
  }

  const v=await pool.query(`INSERT INTO skill_versions(
    company_id,skill_id,version,procedure,source_lesson_ids,assumptions,verification_rules,status
  ) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT') RETURNING *`,[
    input.companyId,definition.id,version,JSON.stringify({steps}),
    JSON.stringify(lessons.map((x)=>x.id)),
    JSON.stringify(['Tutorial advice may not transfer to every product/model/provider.','Tool availability and provider behavior can change.']),
    JSON.stringify(['Do not turn tutorial advice into verified fact.','Run skill tests before ACTIVE status.','Re-test after tool/provider changes.'])
  ]);
  return {definition:{...definition,current_version:version,required_tools:requiredTools,success_criteria:successCriteria},version:v.rows[0]};
}

export async function testSkill(companyId:string,skillId:string){
  const d=await pool.query('SELECT * FROM skill_definitions WHERE id=$1 AND company_id=$2',[skillId,companyId]);
  if(!d.rowCount)throw new Error('Skill not found.');
  const def=d.rows[0];
  const v=await pool.query('SELECT * FROM skill_versions WHERE skill_id=$1 AND version=$2',[skillId,def.current_version]);
  if(!v.rowCount)throw new Error('Skill version missing.');
  const version=v.rows[0];
  const steps=Array.isArray(version.procedure?.steps)?version.procedure.steps:[];
  const sourceIds=Array.isArray(version.source_lesson_ids)?version.source_lesson_ids:[];
  const required=Array.isArray(def.required_tools)?def.required_tools:[];
  const connections=await pool.query('SELECT provider,tool_id,status FROM tool_connections WHERE company_id=$1',[companyId]);
  const connected=new Set(connections.rows.filter((x)=>x.status==='CONNECTED').map((x)=>String(x.tool_id)));
  const checks=[
    {name:'procedure_has_steps',passed:steps.length>0,detail:`${steps.length} step(s)`},
    {name:'provenance_present',passed:sourceIds.length>0,detail:`${sourceIds.length} sourced lesson(s)`},
    {name:'no_empty_instructions',passed:steps.every((x:Record<string,unknown>)=>String(x.instruction||'').trim().length>10),detail:'every step has substantive instruction'},
    {name:'verification_rules_present',passed:Array.isArray(version.verification_rules)&&version.verification_rules.length>0,detail:'verification rules retained'},
    {name:'tool_requirements_known',passed:true,detail:required.length?`requires: ${required.join(', ')}`:'no external tool required'}
  ];
  const blocking=checks.some((x)=>!x.passed);
  const missingTools=required.filter((tool:string)=>!connected.has(tool));
  const status=blocking?'FAILED':missingTools.length?'READY_NEEDS_TOOLS':'PASSED';
  const run=await pool.query(`INSERT INTO skill_test_runs(company_id,skill_id,version,status,results)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[
    companyId,skillId,def.current_version,status,JSON.stringify({checks,missingTools})
  ]);
  const skillStatus=blocking?'DRAFT':missingTools.length?'READY_NEEDS_TOOLS':'ACTIVE';
  await pool.query('UPDATE skill_definitions SET status=$3,updated_at=now() WHERE id=$1 AND company_id=$2',[skillId,companyId,skillStatus]);
  await pool.query('UPDATE skill_versions SET status=$3 WHERE skill_id=$1 AND version=$2',[skillId,def.current_version,skillStatus]);
  return {status,skillStatus,checks,missingTools,run:run.rows[0]};
}
