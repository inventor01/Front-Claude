CREATE TABLE IF NOT EXISTS topic_snapshots (
  owner text NOT NULL,
  topic_key text NOT NULL,
  topic_title text NOT NULL,
  observed integer NOT NULL,
  tier text NOT NULL,
  score real NOT NULL,
  momentum text NOT NULL,
  creators integer NOT NULL,
  evidence_count integer NOT NULL,
  platforms text NOT NULL,
  origin_url text,
  origin_published integer,
  aliases text NOT NULL,
  PRIMARY KEY(owner, topic_key, observed)
);

CREATE INDEX IF NOT EXISTS topic_snapshots_owner_observed_idx ON topic_snapshots(owner, observed DESC);
CREATE INDEX IF NOT EXISTS topic_snapshots_owner_key_idx ON topic_snapshots(owner, topic_key, observed DESC);

CREATE TABLE IF NOT EXISTS coin_match_queue (
  owner text NOT NULL,
  narrative text NOT NULL,
  queued integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  status text NOT NULL DEFAULT 'queued',
  PRIMARY KEY(owner, narrative)
);

CREATE INDEX IF NOT EXISTS coin_match_queue_owner_status_idx ON coin_match_queue(owner, status, queued ASC);

CREATE TABLE IF NOT EXISTS launch_events (
  owner text NOT NULL,
  mint text NOT NULL,
  name text NOT NULL,
  symbol text,
  seen integer NOT NULL,
  narrative text,
  match_type text NOT NULL,
  data text NOT NULL,
  PRIMARY KEY(owner, mint)
);

CREATE INDEX IF NOT EXISTS launch_events_owner_seen_idx ON launch_events(owner, seen DESC);
