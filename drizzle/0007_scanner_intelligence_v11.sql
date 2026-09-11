ALTER TABLE evidence_rich ADD COLUMN creator_followers integer;
ALTER TABLE evidence_rich ADD COLUMN outbound_urls text NOT NULL DEFAULT '[]';
ALTER TABLE evidence_rich ADD COLUMN relation_type text;
ALTER TABLE evidence_rich ADD COLUMN related_video_id text;
ALTER TABLE evidence_rich ADD COLUMN visual_hash text;

ALTER TABLE topic_rich_snapshots ADD COLUMN visual_signals text NOT NULL DEFAULT '[]';
ALTER TABLE topic_rich_snapshots ADD COLUMN semantic_merge text;
ALTER TABLE topic_rich_snapshots ADD COLUMN origin_research text;

CREATE INDEX IF NOT EXISTS evidence_rich_owner_visual_idx
  ON evidence_rich(owner, visual_hash, observed DESC);
CREATE INDEX IF NOT EXISTS evidence_rich_owner_followers_idx
  ON evidence_rich(owner, creator_followers, observed DESC);
