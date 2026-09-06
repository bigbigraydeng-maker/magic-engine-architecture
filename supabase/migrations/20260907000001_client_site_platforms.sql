-- Client site cache-refresh registration.
--
-- One row per customer-facing website that ME manages the cache pipeline for
-- (CTS Tours, Magic Picks, Homara, Roman Hu, ...). Feeding the fields into
-- the Inngest CTS-site-cache-refresh function turns "adding a new customer
-- site" into "one INSERT + one GitHub webhook URL" — no new Render envs.
--
-- Security:
--   RLS locked to service_role only. This table holds a shared secret
--   (revalidate_secret) that the ME app uses to call the customer site's
--   /api/revalidate endpoint. Never exposed to anon or client-authenticated
--   users. Reads/writes happen server-side from Inngest functions and the
--   webhook receiver.

CREATE TABLE IF NOT EXISTS public.client_site_platforms (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  github_repo TEXT NOT NULL UNIQUE,
  origin_url TEXT NOT NULL,
  cloudflare_zone_id TEXT NOT NULL,
  revalidate_secret TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (github_repo LIKE '%/%'),
  CHECK (origin_url LIKE 'https://%')
);

COMMENT ON TABLE public.client_site_platforms IS
  'Per-client site cache config: GitHub repo, Cloudflare zone, revalidate secret. Read by CTS site cache refresh Inngest function.';

CREATE INDEX IF NOT EXISTS idx_client_site_platforms_github_repo
  ON public.client_site_platforms (github_repo);

ALTER TABLE public.client_site_platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_site_platforms_service_role_all ON public.client_site_platforms;
CREATE POLICY client_site_platforms_service_role_all
  ON public.client_site_platforms
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Denormalised: no policy for anon / authenticated. RLS deny-by-default
-- keeps this table service-role-only.

CREATE OR REPLACE FUNCTION public.client_site_platforms_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_site_platforms_updated_at ON public.client_site_platforms;
CREATE TRIGGER client_site_platforms_updated_at
  BEFORE UPDATE ON public.client_site_platforms
  FOR EACH ROW
  EXECUTE FUNCTION public.client_site_platforms_touch_updated_at();
