-- SEO Gap Analysis records
-- Stores results of SEMrush keyword gap CSV analysis pipeline
-- Each record = one analysis run for a client (may merge multiple CSV files)

CREATE TABLE IF NOT EXISTS public.seo_analyses (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title             text         NOT NULL DEFAULT 'SEO Gap Analysis',
  csv_count         integer      NOT NULL DEFAULT 0,
  competitor_count  integer      NOT NULL DEFAULT 0,
  total_keywords    integer      NOT NULL DEFAULT 0,
  b2c_keywords      integer      NOT NULL DEFAULT 0,
  analysis_json     jsonb,
  report_url        text,
  cost_usd          numeric(10,6) NOT NULL DEFAULT 0,
  status            text         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message     text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- Index for client lookups
CREATE INDEX IF NOT EXISTS seo_analyses_client_id_idx
  ON public.seo_analyses (client_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_seo_analyses_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seo_analyses_updated_at
  BEFORE UPDATE ON public.seo_analyses
  FOR EACH ROW EXECUTE FUNCTION update_seo_analyses_updated_at();

-- RLS: only authenticated users (admin) can access
ALTER TABLE public.seo_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seo_analyses_admin_all"
  ON public.seo_analyses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.seo_analyses IS
  'SEMrush keyword gap analysis runs — each row stores parsed CSV data, Claude AI insights, and a DOCX report URL.';
