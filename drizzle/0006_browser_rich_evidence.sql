CREATE TABLE IF NOT EXISTS evidence_rich (
  owner text NOT NULL,
  id text NOT NULL,
  observed integer NOT NULL,
  replies integer,
  reposts integer,
  bookmarks integer,
  quotes integer,
  comments integer,
  shares integer,
  saves integer,
  sound_id text,
  sound_title text,
  sound_author text,
  media_type text,
  quoted_url text,
  cover_url text,
  hashtags text NOT NULL DEFAULT '[]',
  feed_surface text,
  PRIMARY KEY(owner, id, observed)
);

CREATE INDEX IF NOT EXISTS evidence_rich_owner_observed_idx
  ON evidence_rich(owner, observed DESC);
CREATE INDEX IF NOT EXISTS evidence_rich_owner_sound_idx
  ON evidence_rich(owner, sound_id, observed DESC);

CREATE TABLE IF NOT EXISTS topic_rich_snapshots (
  owner text NOT NULL,
  topic_key text NOT NULL,
  observed integer NOT NULL,
  feed_penetration real,
  feed_penetration_delta real,
  feed_penetration_velocity real,
  aliases text NOT NULL DEFAULT '[]',
  sound_signals text NOT NULL DEFAULT '[]',
  PRIMARY KEY(owner, topic_key, observed)
);

CREATE INDEX IF NOT EXISTS topic_rich_snapshots_owner_observed_idx
  ON topic_rich_snapshots(owner, observed DESC);
CREATE INDEX IF NOT EXISTS topic_rich_snapshots_owner_key_idx
  ON topic_rich_snapshots(owner, topic_key, observed DESC);
