-- Billing Monitoring: DataForSEO usage and cost tracking
-- P8.11: Track API calls and costs by client, service, and month

CREATE TABLE datasource_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  api_calls INTEGER NOT NULL DEFAULT 0,
  cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
  month TEXT NOT NULL, -- YYYY-MM format
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, service, month)
);

-- Index for efficient querying by client and month
CREATE INDEX idx_datasource_usage_client_month ON datasource_usage_logs(client_id, month DESC);
CREATE INDEX idx_datasource_usage_service ON datasource_usage_logs(service);
