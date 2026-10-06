CREATE TABLE IF NOT EXISTS front_provider_secrets (
  owner text NOT NULL,
  provider text NOT NULL,
  secret_ciphertext text NOT NULL,
  created integer NOT NULL,
  updated integer NOT NULL,
  last_validated integer,
  validation_status text NOT NULL DEFAULT 'unknown',
  PRIMARY KEY(owner, provider)
);

CREATE INDEX IF NOT EXISTS front_provider_secrets_owner_updated_idx
  ON front_provider_secrets(owner, updated DESC);
