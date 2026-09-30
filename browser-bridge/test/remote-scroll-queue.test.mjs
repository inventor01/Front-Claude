import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function statements(sql){
  return sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
}

test('remote scroll queue migration is idempotent and request IDs dedupe',()=>{
  const db=new DatabaseSync(':memory:');
  const migrations=['../../drizzle/0003_silky_the_call.sql','../../drizzle/0004_dapper_archangel.sql'];
  for(const migration of migrations){
    const sql=fs.readFileSync(new URL(migration,import.meta.url),'utf8');
    for(const stmt of statements(sql))db.exec(stmt);
  }
  for(const migration of migrations){
    const sql=fs.readFileSync(new URL(migration,import.meta.url),'utf8');
    for(const stmt of statements(sql))db.exec(stmt);
  }

  const now=Date.now();
  db.prepare(`INSERT INTO agent_scroll_jobs(owner,id,caller,request_id,status,phase,request_json,created)
    VALUES(?,?,?,?,?,?,?,?)`).run('owner','job-a','AI_EMPLOYEE_OS','req-1','QUEUED','QUEUED','{}',now);
  assert.throws(()=>db.prepare(`INSERT INTO agent_scroll_jobs(owner,id,caller,request_id,status,phase,request_json,created)
    VALUES(?,?,?,?,?,?,?,?)`).run('owner','job-b','AI_EMPLOYEE_OS','req-1','QUEUED','QUEUED','{}',now+1));
  db.close();
});

test('remote scroll queue only reclaims expired active leases',()=>{
  const db=new DatabaseSync(':memory:');
  for(const migration of ['../../drizzle/0003_silky_the_call.sql','../../drizzle/0004_dapper_archangel.sql']){
    const sql=fs.readFileSync(new URL(migration,import.meta.url),'utf8');
    for(const stmt of statements(sql))db.exec(stmt);
  }
  const now=Date.now();
  const insert=db.prepare(`INSERT INTO agent_scroll_jobs(owner,id,caller,request_id,status,phase,request_json,lease_id,lease_expires_at,created)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  insert.run('owner','expired','AI_EMPLOYEE_OS','expired','SCROLLING','SCROLLING','{}','old',now-1,now-1000);
  insert.run('owner','active','AI_EMPLOYEE_OS','active','SCROLLING','SCROLLING','{}','current',now+60000,now-500);
  insert.run('owner','queued','AI_EMPLOYEE_OS','queued','QUEUED','QUEUED','{}',null,null,now);

  const claimable=db.prepare(`SELECT id FROM agent_scroll_jobs
    WHERE owner=? AND cancel_requested=0 AND (
      status='QUEUED' OR (status IN ('CLAIMED','SCROLLING','ANALYZING','UPLOADING') AND COALESCE(lease_expires_at,0)<?)
    ) ORDER BY created ASC`).all('owner',now).map(x=>x.id);
  assert.deepEqual(claimable,['expired','queued']);
  assert.equal(claimable.includes('active'),false);
  db.close();
});
