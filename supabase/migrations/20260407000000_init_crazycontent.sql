-- CrazyContent Database Schema
-- Created: 2026-04-07
-- 8 new tables with RLS policies

-- 1. content_tasks - Content generation task queue
CREATE TABLE IF NOT EXISTS public.content_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES public.content_topics(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  platforms TEXT[] NOT NULL DEFAULT ARRAY['facebook', 'xiaohongshu'],
  generated_captions JSONB,
  image_url TEXT,
  image_metadata JSONB,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_tasks_project_status ON public.content_tasks(project_id, status);
CREATE INDEX idx_content_tasks_scheduled ON public.content_tasks(scheduled_at) WHERE status = 'pending';
ALTER TABLE public.content_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_tasks_owner_all" ON public.content_tasks FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = content_tasks.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = content_tasks.project_id AND p.user_id = auth.uid()
  ));

-- 2. content_topics - Topic library for content generation
CREATE TABLE IF NOT EXISTS public.content_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT[],
  target_audience TEXT,
  tone TEXT DEFAULT 'professional' CHECK (tone IN ('professional', 'casual', 'inspirational')),
  frequency_daily INT DEFAULT 1,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_topics_project ON public.content_topics(project_id);
ALTER TABLE public.content_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_topics_owner_all" ON public.content_topics FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = content_topics.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = content_topics.project_id AND p.user_id = auth.uid()
  ));

-- 3. social_sources - Connected social media accounts
CREATE TABLE IF NOT EXISTS public.social_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'xiaohongshu')),
  account_id TEXT NOT NULL,
  account_name TEXT,
  api_token TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, platform, account_id)
);

CREATE INDEX idx_social_sources_project ON public.social_sources(project_id);
ALTER TABLE public.social_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_sources_owner_all" ON public.social_sources FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = social_sources.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = social_sources.project_id AND p.user_id = auth.uid()
  ));

-- 4. collected_posts - Scraped social media content
CREATE TABLE IF NOT EXISTS public.collected_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.social_sources(id) ON DELETE CASCADE,
  external_post_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'xiaohongshu')),
  content TEXT,
  image_urls TEXT[],
  original_url TEXT,
  published_at TIMESTAMPTZ,
  metrics JSONB NOT NULL DEFAULT '{"likes":0,"comments":0,"shares":0,"views":0}',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_post_id)
);

CREATE INDEX idx_collected_posts_source ON public.collected_posts(source_id, collected_at DESC);
CREATE INDEX idx_collected_posts_metrics ON public.collected_posts USING GIN(metrics);
ALTER TABLE public.collected_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collected_posts_owner_all" ON public.collected_posts FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.social_sources ss
    JOIN public.projects p ON p.id = ss.project_id
    WHERE ss.id = collected_posts.source_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.social_sources ss
    JOIN public.projects p ON p.id = ss.project_id
    WHERE ss.id = collected_posts.source_id AND p.user_id = auth.uid()
  ));

-- 5. feedback_data - Engagement feedback data
CREATE TABLE IF NOT EXISTS public.feedback_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_post_id UUID NOT NULL REFERENCES public.collected_posts(id) ON DELETE CASCADE,
  content_task_id UUID REFERENCES public.content_tasks(id) ON DELETE SET NULL,
  engagement_score FLOAT CHECK (engagement_score >= 0 AND engagement_score <= 100),
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  trending_topics TEXT[],
  audience_segment TEXT,
  peak_hours INT[],
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_data_task ON public.feedback_data(content_task_id);
CREATE INDEX idx_feedback_data_post ON public.feedback_data(collected_post_id);
ALTER TABLE public.feedback_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feedback_data_owner_all" ON public.feedback_data FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collected_posts cp
    JOIN public.social_sources ss ON ss.id = cp.source_id
    JOIN public.projects p ON p.id = ss.project_id
    WHERE cp.id = feedback_data.collected_post_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.collected_posts cp
    JOIN public.social_sources ss ON ss.id = cp.source_id
    JOIN public.projects p ON p.id = ss.project_id
    WHERE cp.id = feedback_data.collected_post_id AND p.user_id = auth.uid()
  ));

-- 6. trending_reports - Daily trending topics report
CREATE TABLE IF NOT EXISTS public.trending_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  report_content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, report_date)
);

CREATE INDEX idx_trending_reports_project_date ON public.trending_reports(project_id, report_date DESC);
ALTER TABLE public.trending_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trending_reports_owner_all" ON public.trending_reports FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = trending_reports.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = trending_reports.project_id AND p.user_id = auth.uid()
  ));

-- 7. generation_logs - Audit log for generation operations
CREATE TABLE IF NOT EXISTS public.generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.content_tasks(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  input_prompt JSONB,
  output_result JSONB,
  cost_usd FLOAT,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_generation_logs_project ON public.generation_logs(project_id, created_at DESC);
ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generation_logs_owner_all" ON public.generation_logs FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
  ));

-- 8. generation_params - Parameters for content generation (for feedback optimization)
CREATE TABLE IF NOT EXISTS public.generation_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES public.content_topics(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'xiaohongshu')),
  prompt_template TEXT,
  model TEXT DEFAULT 'gpt-4o-mini',
  temperature FLOAT DEFAULT 0.7 CHECK (temperature >= 0.3 AND temperature <= 0.9),
  max_tokens INT DEFAULT 500,
  tone_weight FLOAT DEFAULT 1.0 CHECK (tone_weight >= 0.5 AND tone_weight <= 1.5),
  engagement_optimization_enabled BOOLEAN DEFAULT true,
  last_optimized_at TIMESTAMPTZ,
  optimization_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_generation_params_project ON public.generation_params(project_id);
ALTER TABLE public.generation_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generation_params_owner_all" ON public.generation_params FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = generation_params.project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = generation_params.project_id AND p.user_id = auth.uid()
  ));
