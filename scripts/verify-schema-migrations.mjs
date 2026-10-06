import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const schemaPath=path.join(root,'db','schema.ts');
const migrationsDir=path.join(root,'drizzle');

const schema=fs.readFileSync(schemaPath,'utf8');
const tableNames=[...schema.matchAll(/sqliteTable\(\s*['"`]([^'"`]+)['"`]/g)].map((match)=>match[1]);
if(!tableNames.length){
  console.error('[schema-migrations] No sqliteTable declarations found in db/schema.ts.');
  process.exit(1);
}

const files=fs.readdirSync(migrationsDir).filter((name)=>/^\d+.*\.sql$/.test(name)).sort();
if(!files.length){
  console.error('[schema-migrations] No committed SQL migrations found.');
  process.exit(1);
}
const sql=files.map((name)=>fs.readFileSync(path.join(migrationsDir,name),'utf8')).join('\n').toLowerCase();

const missing=tableNames.filter((name)=>{
  const escaped=name.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  return !new RegExp('(?:create\\s+table(?:\\s+if\\s+not\\s+exists)?|alter\\s+table)\\s+["`\\[]?'+escaped+'(?:["`\\]]|\\s|\\()', 'i').test(sql);
});

if(missing.length){
  console.error('[schema-migrations] db/schema.ts tables missing from committed SQL migrations:');
  for(const name of missing)console.error(' - '+name);
  process.exit(1);
}

const requiredSocialArb={
  social_arb_observations:['signal_key','observed','ticker_verified','behaviors','change_json'],
  social_arb_company_mappings:['signal_key','mapping_status','ticker_verified','ownership_verified','confidence'],
};
const socialSql=files.filter((name)=>/social_arbitrage/i.test(name)).map((name)=>fs.readFileSync(path.join(migrationsDir,name),'utf8').toLowerCase()).join('\n');
for(const [table,columns] of Object.entries(requiredSocialArb)){
  if(!socialSql.includes(table)){
    console.error('[schema-migrations] Social Arb migration is missing table '+table);
    process.exit(1);
  }
  for(const column of columns){
    if(!socialSql.includes(column)){
      console.error('[schema-migrations] Social Arb migration is missing '+table+'.'+column);
      process.exit(1);
    }
  }
}

console.log('[schema-migrations] '+tableNames.length+' schema tables are represented by '+files.length+' committed SQL migrations.');
