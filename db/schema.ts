import { sqliteTable, text, real, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const watchlist=sqliteTable('watchlist',{owner:text('owner').notNull(),mint:text('mint').notNull(),name:text('name').notNull(),created:integer('created').notNull()},t=>[primaryKey({columns:[t.owner,t.mint]})]);
export const trades=sqliteTable('trades',{id:text('id').notNull(),owner:text('owner').notNull(),mint:text('mint').notNull(),name:text('name').notNull(),amount:real('amount').notNull(),quantity:real('quantity').notNull(),entry:real('entry').notNull(),opened:integer('opened').notNull(),exit:real('exit'),closed:integer('closed'),proceeds:real('proceeds')},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const cache=sqliteTable('cache',{key:text('key').primaryKey(),value:text('value').notNull(),expires:integer('expires').notNull()});
export const settings=sqliteTable('settings',{owner:text('owner').primaryKey(),secret:text('secret').notNull(),accounts:text('accounts').notNull()});
export const evidence=sqliteTable('evidence',{owner:text('owner').notNull(),id:text('id').notNull(),platform:text('platform').notNull(),author:text('author').notNull(),url:text('url').notNull(),content:text('content').notNull(),published:integer('published'),firstSeen:integer('first_seen').notNull(),lastSeen:integer('last_seen').notNull(),provenance:text('provenance').notNull()},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const observations=sqliteTable('observations',{owner:text('owner').notNull(),id:text('id').notNull(),observed:integer('observed').notNull(),views:integer('views'),likes:integer('likes')},t=>[primaryKey({columns:[t.owner,t.id,t.observed]})]);
export const narratives=sqliteTable('narratives',{owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),aliases:text('aliases').notNull(),created:integer('created').notNull()},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const evidenceLinks=sqliteTable('evidence_links',{owner:text('owner').notNull(),narrative:text('narrative').notNull(),evidence:text('evidence').notNull(),reason:text('reason').notNull()},t=>[primaryKey({columns:[t.owner,t.narrative,t.evidence]})]);
export const collector=sqliteTable('collector',{owner:text('owner').primaryKey(),state:text('state').notNull(),lockUntil:integer('lock_until').notNull().default(0),lockId:text('lock_id').notNull().default('')});
export const usage=sqliteTable('usage',{owner:text('owner').notNull(),day:text('day').notNull(),reserved:integer('reserved').notNull().default(0)},t=>[primaryKey({columns:[t.owner,t.day]})]);
export const narrativeCoins=sqliteTable('narrative_coins',{owner:text('owner').notNull(),narrative:text('narrative').notNull(),mint:text('mint').notNull(),data:text('data').notNull(),observed:integer('observed').notNull()},t=>[primaryKey({columns:[t.owner,t.narrative,t.mint]})]);

export const agentScrollJobs=sqliteTable('agent_scroll_jobs',{
  owner:text('owner').notNull(),id:text('id').notNull(),caller:text('caller').notNull(),requestId:text('request_id').notNull(),
  status:text('status').notNull(),phase:text('phase').notNull().default('QUEUED'),requestJson:text('request_json').notNull(),
  leaseId:text('lease_id'),leaseExpiresAt:integer('lease_expires_at'),bridgeId:text('bridge_id'),scanId:text('scan_id'),
  observedCount:integer('observed_count').notNull().default(0),platformCounts:text('platform_counts').notNull().default('{}'),
  resultJson:text('result_json'),limitations:text('limitations').notNull().default('[]'),error:text('error'),
  cancelRequested:integer('cancel_requested').notNull().default(0),created:integer('created').notNull(),started:integer('started'),
  heartbeat:integer('heartbeat'),completed:integer('completed')
},t=>[
  primaryKey({columns:[t.owner,t.id]}),
  uniqueIndex('idx_agent_scroll_jobs_request').on(t.owner,t.caller,t.requestId),
  index('idx_agent_scroll_jobs_claim').on(t.owner,t.status,t.leaseExpiresAt,t.created)
]);
export const agentScrollEvidence=sqliteTable('agent_scroll_evidence',{
  owner:text('owner').notNull(),jobId:text('job_id').notNull(),evidenceId:text('evidence_id').notNull(),
  platform:text('platform').notNull(),payload:text('payload').notNull(),created:integer('created').notNull(),updated:integer('updated').notNull()
},t=>[
  primaryKey({columns:[t.owner,t.jobId,t.evidenceId]}),
  index('idx_agent_scroll_evidence_job').on(t.owner,t.jobId,t.updated)
]);
export const bridgeAgents=sqliteTable('bridge_agents',{
  owner:text('owner').notNull(),id:text('id').notNull(),label:text('label').notNull(),status:text('status').notNull(),
  lastSeen:integer('last_seen').notNull(),capabilities:text('capabilities').notNull().default('{}'),created:integer('created').notNull()
},t=>[primaryKey({columns:[t.owner,t.id]})]);
