CREATE TABLE IF NOT EXISTS dashboard_dismissals (
  owner text NOT NULL,
  item_key text NOT NULL,
  created integer NOT NULL,
  PRIMARY KEY(owner, item_key)
);

CREATE INDEX IF NOT EXISTS dashboard_dismissals_owner_created_idx ON dashboard_dismissals(owner, created DESC);
