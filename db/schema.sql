CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  github_id BIGINT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  queue_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_installation_id BIGINT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repositories (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL UNIQUE,
  full_name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id BIGSERIAL PRIMARY KEY,
  repository_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL UNIQUE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author_login TEXT NOT NULL,
  author_avatar_url TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  draft BOOLEAN NOT NULL DEFAULT FALSE,
  merged BOOLEAN NOT NULL DEFAULT FALSE,
  base_branch TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  ready_at TIMESTAMPTZ,
  review_state TEXT NOT NULL DEFAULT 'pending',
  requested_reviewers JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_reviewers JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_status TEXT NOT NULL DEFAULT 'unknown',
  workflow_status TEXT NOT NULL DEFAULT 'unknown',
  commit_status TEXT NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, number)
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pull_request_id BIGINT NOT NULL UNIQUE REFERENCES pull_requests(id) ON DELETE CASCADE,
  queue_order BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_reviewed_sha TEXT,
  last_requeued_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS queue_entries_active_order_idx
  ON queue_entries (organization_id, active, queue_order);

CREATE INDEX IF NOT EXISTS pull_requests_head_sha_idx
  ON pull_requests (repository_id, head_sha);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id BIGINT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL UNIQUE,
  reviewer_login TEXT NOT NULL,
  state TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_snapshots (
  id BIGSERIAL PRIMARY KEY,
  repository_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pull_request_id BIGINT REFERENCES pull_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'workflow', 'commit')),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL,
  conclusion TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, kind, external_id)
);

CREATE INDEX IF NOT EXISTS status_snapshots_pr_sha_idx
  ON status_snapshots (pull_request_id, head_sha, kind);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  github_delivery_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  action TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_idx
  ON webhook_deliveries (status, received_at);

CREATE TABLE IF NOT EXISTS slack_events (
  id BIGSERIAL PRIMARY KEY,
  slack_event_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS slack_events_pending_idx
  ON slack_events (status, received_at);
