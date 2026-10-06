CREATE TABLE IF NOT EXISTS social_arb_outcomes (
  owner text NOT NULL,
  research_id text NOT NULL,
  signal_key text NOT NULL,
  ticker text NOT NULL,
  provider text NOT NULL,
  captured integer NOT NULL,
  baseline_price real,
  baseline_at integer,
  baseline_kind text,
  status text NOT NULL DEFAULT 'provider-unconfigured',
  last_evaluated integer,
  data text NOT NULL DEFAULT '{}',
  PRIMARY KEY(owner, research_id)
);

CREATE INDEX IF NOT EXISTS social_arb_outcomes_owner_signal_idx
  ON social_arb_outcomes(owner, signal_key, captured DESC);

CREATE INDEX IF NOT EXISTS social_arb_outcomes_owner_status_idx
  ON social_arb_outcomes(owner, status, captured DESC);

CREATE INDEX IF NOT EXISTS social_arb_outcomes_owner_ticker_idx
  ON social_arb_outcomes(owner, ticker, captured DESC);
