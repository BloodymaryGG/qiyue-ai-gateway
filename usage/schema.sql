CREATE TABLE IF NOT EXISTS gateway_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project TEXT NOT NULL,
  requested_model TEXT,
  provider TEXT,
  provider_model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(14, 8),
  status TEXT NOT NULL DEFAULT 'success',
  status_code INTEGER NOT NULL DEFAULT 200,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  streamed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS gateway_usage_created_at_idx ON gateway_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS gateway_usage_project_created_at_idx ON gateway_usage (project, created_at DESC);
