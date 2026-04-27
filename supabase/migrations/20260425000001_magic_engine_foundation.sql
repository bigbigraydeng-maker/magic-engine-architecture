-- ============================================
-- Magic Engine Foundation Tables
-- 2026-04-25
-- ============================================

-- 1. clients（客户表）
CREATE TABLE IF NOT EXISTS public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  domain            text,
  semrush_db        text DEFAULT 'au',
  monthly_quota     integer DEFAULT 5000,
  plan_tier         text DEFAULT 'starter'
                    CHECK (plan_tier IN ('starter','growth','enterprise')),
  airtable_base_id  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.clients FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. master_briefs（品牌底座）
CREATE TABLE IF NOT EXISTS public.master_briefs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version           smallint NOT NULL DEFAULT 1,
  is_active         boolean DEFAULT true,
  brand_name        text NOT NULL,
  tagline           text,
  website           text,
  primary_audience  text,
  pain_points       text[],
  buying_trigger    text,
  products          jsonb,         -- [{name, description, price_range, season, usp}]
  tone              text,
  voice_examples    text[],
  avoid_words       text[],
  content_topics    text[],
  content_avoid     text[],
  platforms         text[],
  post_frequency    text,
  visual_style      text,
  color_palette     text[],
  image_preference  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.master_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. keywords（关键词表）
CREATE TABLE IF NOT EXISTS public.keywords (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  keyword               text NOT NULL,
  volume                integer,
  kd                    smallint,
  cpc                   numeric(6,2),
  intent                text CHECK (intent IN ('informational','commercial','transactional','navigational')),
  trend                 jsonb,
  source                text NOT NULL
                        CHECK (source IN ('semrush_batch','semrush_related','semrush_gap')),
  competitor_source     text,
  semrush_db            text DEFAULT 'au',
  opportunity_score     numeric(5,2),
  recommended_page_type text CHECK (recommended_page_type IN ('hub','guide','landing','faq')),
  status                text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','reviewed','approved','rejected','page_created','published')),
  status_updated_at     timestamptz,
  status_updated_by     text,
  airtable_record_id    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.keywords FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX idx_keywords_client_keyword ON public.keywords(client_id, keyword);
CREATE INDEX idx_keywords_client_status ON public.keywords(client_id, status);
CREATE INDEX idx_keywords_score ON public.keywords(client_id, opportunity_score DESC) WHERE status = 'approved';

-- 4. content_posts（内容日历）
CREATE TABLE IF NOT EXISTS public.content_posts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  route                 text NOT NULL CHECK (route IN ('route_a','route_b','route_c')),
  platforms             text[] NOT NULL,
  script                text,
  caption               text,
  hashtags              text[],
  visual_brief          text,
  revision_notes        text,
  source_keyword_id     uuid REFERENCES public.keywords(id),
  source_video_url      text,
  source_brief_id       uuid REFERENCES public.master_briefs(id),
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','scheduled','published','rejected')),
  scheduled_at          timestamptz,
  published_at          timestamptz,
  publer_post_id        text,
  airtable_record_id    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.content_posts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. semrush_usage_logs（API用量追踪）
CREATE TABLE IF NOT EXISTS public.semrush_usage_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES public.clients(id),
  endpoint          text NOT NULL,
  units_consumed    integer NOT NULL DEFAULT 0,
  keywords_count    integer DEFAULT 0,
  called_at         timestamptz NOT NULL DEFAULT now()
);

-- updated_at 自动触发器
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER keywords_updated_at
  BEFORE UPDATE ON public.keywords
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER content_posts_updated_at
  BEFORE UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER master_briefs_updated_at
  BEFORE UPDATE ON public.master_briefs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Opportunity Score 计算函数
CREATE OR REPLACE FUNCTION public.calculate_opportunity_score(
  p_volume  integer,
  p_kd      smallint,
  p_cpc     numeric,
  p_intent  text,
  p_is_gap  boolean DEFAULT false
)
RETURNS numeric AS $$
DECLARE
  volume_score  numeric;
  kd_score      numeric;
  cpc_score     numeric;
  intent_score  numeric;
  gap_bonus     numeric;
BEGIN
  volume_score := least(100, (log(greatest(p_volume, 1)) / log(10000)) * 100);
  kd_score     := greatest(0, 100 - COALESCE(p_kd, 50));
  cpc_score    := least(100, (COALESCE(p_cpc, 0) / 10.0) * 100);
  intent_score := CASE p_intent
    WHEN 'transactional' THEN 100
    WHEN 'commercial'    THEN 80
    WHEN 'navigational'  THEN 30
    WHEN 'informational' THEN 20
    ELSE 10
  END;
  gap_bonus := CASE WHEN p_is_gap THEN 100 ELSE 0 END;

  RETURN round(
    (volume_score * 0.30) +
    (intent_score * 0.30) +
    (cpc_score    * 0.20) +
    (kd_score     * 0.15) +
    (gap_bonus    * 0.05),
    2
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
