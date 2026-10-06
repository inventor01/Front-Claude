CREATE TABLE IF NOT EXISTS social_arb_research_runs (
  owner text NOT NULL,
  id text NOT NULL,
  signal_key text NOT NULL,
  researched integer NOT NULL,
  social_score real NOT NULL DEFAULT 0,
  social_status text NOT NULL DEFAULT 'WATCH',
  materiality_status text NOT NULL DEFAULT 'exposure-unquantified',
  awareness_status text NOT NULL DEFAULT 'insufficient-data',
  information_gap_state text NOT NULL DEFAULT 'unmeasured',
  filing_count integer NOT NULL DEFAULT 0,
  financial_news_count integer NOT NULL DEFAULT 0,
  data text NOT NULL DEFAULT '{}',
  PRIMARY KEY(owner, id)
);

CREATE INDEX IF NOT EXISTS social_arb_research_runs_owner_signal_idx
  ON social_arb_research_runs(owner, signal_key, researched DESC);

CREATE INDEX IF NOT EXISTS social_arb_research_runs_owner_gap_idx
  ON social_arb_research_runs(owner, information_gap_state, researched DESC);
