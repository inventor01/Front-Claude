CREATE TABLE IF NOT EXISTS agent_scroll_jobs (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  caller TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'QUEUED',
  request_json TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at INTEGER,
  bridge_id TEXT,
  scan_id TEXT,
  observed_count INTEGER NOT NULL DEFAULT 0,
  platform_counts TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  limitations TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  started INTEGER,
  heartbeat INTEGER,
  completed INTEGER,
  PRIMARY KEY(owner,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_scroll_jobs_request
  ON agent_scroll_jobs(owner,caller,request_id);
CREATE INDEX IF NOT EXISTS idx_agent_scroll_jobs_claim
  ON agent_scroll_jobs(owner,status,lease_expires_at,created);

CREATE TABLE IF NOT EXISTS agent_scroll_evidence (
  owner TEXT NOT NULL,
  job_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY(owner,job_id,evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_scroll_evidence_job
  ON agent_scroll_evidence(owner,job_id,updated);

CREATE TABLE IF NOT EXISTS bridge_agents (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL,
  PRIMARY KEY(owner,id)
);
