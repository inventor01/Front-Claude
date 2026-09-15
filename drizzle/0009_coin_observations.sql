CREATE TABLE IF NOT EXISTS coin_market_snapshots (
 owner TEXT NOT NULL, narrative TEXT NOT NULL, mint TEXT NOT NULL,
 observed INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(owner,narrative,mint,observed)
);
CREATE INDEX IF NOT EXISTS coin_snapshot_history ON coin_market_snapshots(owner,narrative,mint,observed);

CREATE TABLE IF NOT EXISTS pump_creation_events (
 owner TEXT NOT NULL, mint TEXT NOT NULL, name TEXT NOT NULL, symbol TEXT,
 seen INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,mint)
);
CREATE INDEX IF NOT EXISTS pump_creation_recent ON pump_creation_events(owner,seen);
CREATE TABLE IF NOT EXISTS narrative_coin_candidates (
 owner TEXT NOT NULL, narrative TEXT NOT NULL, mint TEXT NOT NULL,
 name TEXT NOT NULL, symbol TEXT, seen INTEGER NOT NULL,
 match_type TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(owner,narrative,mint)
);
