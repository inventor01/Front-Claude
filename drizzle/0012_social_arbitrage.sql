CREATE TABLE IF NOT EXISTS social_arb_observations (
  owner text NOT NULL,
  signal_key text NOT NULL,
  observed integer NOT NULL,
  title text NOT NULL,
  product text,
  brand text,
  company_name text,
  ticker text,
  relation text,
  direction text NOT NULL DEFAULT 'unknown',
  materiality text,
  mapping_status text NOT NULL DEFAULT 'unmapped',
  ticker_verified integer NOT NULL DEFAULT 0,
  score real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'WATCH',
  author_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  platforms text NOT NULL DEFAULT '[]',
  behaviors text NOT NULL DEFAULT '{}',
  change_json text NOT NULL DEFAULT '{}',
  thesis text,
  data text NOT NULL DEFAULT '{}',
  PRIMARY KEY(owner, signal_key, observed)
);

CREATE INDEX IF NOT EXISTS social_arb_observations_owner_observed_idx
  ON social_arb_observations(owner, observed DESC);

CREATE INDEX IF NOT EXISTS social_arb_observations_owner_score_idx
  ON social_arb_observations(owner, score DESC, observed DESC);

CREATE TABLE IF NOT EXISTS social_arb_company_mappings (
  owner text NOT NULL,
  signal_key text NOT NULL,
  ticker text,
  company_name text,
  brand text,
  relation text,
  mapping_status text NOT NULL DEFAULT 'unmapped',
  ticker_verified integer NOT NULL DEFAULT 0,
  ownership_verified integer NOT NULL DEFAULT 0,
  confidence real NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'social-arb-engine',
  updated integer NOT NULL,
  PRIMARY KEY(owner, signal_key)
);

CREATE INDEX IF NOT EXISTS social_arb_company_mappings_owner_ticker_idx
  ON social_arb_company_mappings(owner, ticker);
