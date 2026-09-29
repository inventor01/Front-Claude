CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  PRIMARY KEY(user_id, company_id)
);
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  title text NOT NULL,
  department text NOT NULL,
  mission text NOT NULL,
  manager_slug text,
  autonomy_mode text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  status text NOT NULL DEFAULT 'READY',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, slug)
);
CREATE TABLE IF NOT EXISTS objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  statement text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  objective_id uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  name text NOT NULL,
  phase text NOT NULL DEFAULT 'PRODUCT_RESEARCH',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_employee_slug text NOT NULL,
  assigned_employee_slug text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'READY',
  risk_level text NOT NULL DEFAULT 'LOW',
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  employee_slug text NOT NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'QUEUED',
  priority integer NOT NULL DEFAULT 50,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  lease_id uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, idempotency_key)
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS jobs_runnable_idx ON jobs(status, scheduled_for, priority DESC);
CREATE TABLE IF NOT EXISTS job_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  step_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence)
);
CREATE TABLE IF NOT EXISTS employee_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE CASCADE,
  type text NOT NULL,
  from_employee_slug text NOT NULL,
  to_employee_slug text NOT NULL,
  objective text NOT NULL,
  required_output text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  authority_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  requested_by_employee_slug text NOT NULL,
  action_type text NOT NULL,
  action_payload jsonb NOT NULL,
  reason text NOT NULL,
  risk text NOT NULL,
  cost_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE CASCADE,
  employee_slug text NOT NULL,
  evidence_type text NOT NULL,
  source_type text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  external_id text,
  content_summary text NOT NULL,
  raw_reference jsonb,
  confidence text NOT NULL DEFAULT 'UNKNOWN',
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_company_time_idx ON events(company_id, created_at DESC);
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_slug text,
  type text NOT NULL,
  subject text NOT NULL,
  content text NOT NULL,
  source text,
  confidence text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  supersedes uuid REFERENCES memories(id)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  result_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id, key)
);
CREATE TABLE IF NOT EXISTS tool_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tool_id text NOT NULL,
  provider text NOT NULL,
  risk_class text NOT NULL,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, tool_id)
);


CREATE TABLE IF NOT EXISTS product_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL,
  score integer NOT NULL,
  confidence text NOT NULL,
  discovery_mode text NOT NULL,
  trend_growth_pct numeric,
  demand_score integer NOT NULL,
  marketplace_seen boolean NOT NULL DEFAULT false,
  supplier_seen boolean NOT NULL DEFAULT false,
  observed_market_price numeric,
  observed_source_price numeric,
  observed_gross_margin_pct numeric,
  contentability_score integer NOT NULL,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  creative_angles jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);
CREATE INDEX IF NOT EXISTS product_candidates_company_idx ON product_candidates(company_id, created_at DESC);


CREATE TABLE IF NOT EXISTS store_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES product_candidates(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'DRAFT',
  brand_direction jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_architecture jsonb NOT NULL DEFAULT '[]'::jsonb,
  copy_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  qa_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,candidate_id)
);
CREATE INDEX IF NOT EXISTS store_packages_company_idx ON store_packages(company_id,created_at DESC);


CREATE TABLE IF NOT EXISTS creative_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES product_candidates(id) ON DELETE CASCADE,
  store_package_id uuid REFERENCES store_packages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  hooks jsonb NOT NULL DEFAULT '[]'::jsonb,
  scripts jsonb NOT NULL DEFAULT '[]'::jsonb,
  storyboards jsonb NOT NULL DEFAULT '[]'::jsonb,
  qa_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,candidate_id)
);
CREATE INDEX IF NOT EXISTS creative_packages_company_idx ON creative_packages(company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS distribution_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  creative_package_id uuid NOT NULL REFERENCES creative_packages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'DRAFT',
  channel_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  calendar jsonb NOT NULL DEFAULT '[]'::jsonb,
  caption_templates jsonb NOT NULL DEFAULT '[]'::jsonb,
  qa_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,creative_package_id)
);
CREATE INDEX IF NOT EXISTS distribution_packages_company_idx ON distribution_packages(company_id,created_at DESC);


CREATE TABLE IF NOT EXISTS support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  channel text NOT NULL,
  customer_ref text NOT NULL,
  subject text NOT NULL,
  customer_message text NOT NULL,
  status text NOT NULL DEFAULT 'NEW',
  category text,
  severity text,
  draft_response text,
  resolution text,
  external_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_cases_company_idx ON support_cases(company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS issue_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pattern_key text NOT NULL,
  category text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  latest_example text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,pattern_key)
);
CREATE INDEX IF NOT EXISTS issue_patterns_company_idx ON issue_patterns(company_id,last_seen_at DESC);


CREATE TABLE IF NOT EXISTS reasoning_profiles (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_slug text NOT NULL,
  first_principles boolean NOT NULL DEFAULT true,
  forward_horizon_steps integer NOT NULL DEFAULT 3,
  uncertainty_policy text NOT NULL DEFAULT 'NEVER_ASSUME',
  learning_policy text NOT NULL DEFAULT 'LEARN_FROM_BEST_AVAILABLE_EVIDENCE',
  operating_principles jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,employee_slug)
);

CREATE TABLE IF NOT EXISTS training_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_slug text,
  source_type text NOT NULL,
  title text NOT NULL,
  source_url text,
  source_author text,
  raw_content text NOT NULL,
  source_quality text NOT NULL DEFAULT 'UNVERIFIED',
  status text NOT NULL DEFAULT 'ACTIVE',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ingest_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_sources_company_employee_idx ON training_sources(company_id,employee_slug,created_at DESC);

CREATE TABLE IF NOT EXISTS training_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES training_sources(id) ON DELETE CASCADE,
  employee_slug text,
  lesson_type text NOT NULL,
  principle text NOT NULL,
  applicability text NOT NULL,
  confidence text NOT NULL DEFAULT 'LOW',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_lessons_company_employee_idx ON training_lessons(company_id,employee_slug,status,created_at DESC);

CREATE TABLE IF NOT EXISTS tool_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tool_id text NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  capability text NOT NULL,
  verification_grade text NOT NULL DEFAULT 'UNKNOWN',
  automation_policy text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  source_url text,
  status text NOT NULL DEFAULT 'AVAILABLE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_by text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,tool_id)
);
CREATE INDEX IF NOT EXISTS tool_catalog_company_capability_idx ON tool_catalog(company_id,capability,status);

CREATE TABLE IF NOT EXISTS tool_discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  claim_type text NOT NULL,
  query text NOT NULL,
  status text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  employee_slug text NOT NULL,
  claim_type text NOT NULL,
  claim_text text NOT NULL,
  desired_grade text NOT NULL DEFAULT 'VERIFIED_FIRST_PARTY',
  status text NOT NULL DEFAULT 'PENDING',
  selected_tool_id text,
  result_summary text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_claims_company_idx ON verification_claims(company_id,status,created_at DESC);


CREATE TABLE IF NOT EXISTS integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  connection_id uuid NOT NULL REFERENCES tool_connections(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,provider,connection_id)
);

CREATE TABLE IF NOT EXISTS skill_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_slug text,
  slug text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  current_version integer NOT NULL DEFAULT 1,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,slug)
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  procedure jsonb NOT NULL,
  source_lesson_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(skill_id,version)
);

CREATE TABLE IF NOT EXISTS skill_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_definitions_company_idx ON skill_definitions(company_id,employee_slug,status,updated_at DESC);
