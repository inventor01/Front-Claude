CREATE TABLE IF NOT EXISTS front_page_views (
  scope text NOT NULL,
  session_id text NOT NULL,
  first_seen integer NOT NULL,
  PRIMARY KEY(scope, session_id)
);

CREATE INDEX IF NOT EXISTS front_page_views_scope_seen_idx
  ON front_page_views(scope, first_seen DESC);
