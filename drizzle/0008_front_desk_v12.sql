CREATE TABLE IF NOT EXISTS learning_archive (
  owner text NOT NULL,
  id text NOT NULL,
  created integer NOT NULL,
  kind text NOT NULL,
  data text NOT NULL,
  PRIMARY KEY(owner,id)
);

CREATE INDEX IF NOT EXISTS learning_archive_owner_created_idx
  ON learning_archive(owner,created DESC);
