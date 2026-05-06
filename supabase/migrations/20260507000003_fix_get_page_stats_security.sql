-- P8.0.8: Fix get_page_stats SECURITY DEFINER without SET search_path
--
-- The original definition in 20260506000002_get_page_stats_rpc.sql omitted
-- SET search_path, making it vulnerable to search_path injection.
-- Switching to SECURITY INVOKER is safer: the caller (service_role) already
-- has SELECT on client_site_pages, so no privileges are lost.

CREATE OR REPLACE FUNCTION get_page_stats(client_id UUID)
RETURNS TABLE (
  total_count    BIGINT,
  blog_count     BIGINT,
  product_count  BIGINT,
  service_count  BIGINT,
  landing_count  BIGINT,
  about_count    BIGINT,
  contact_count  BIGINT,
  other_count    BIGINT,
  geo_yes        BIGINT,
  geo_no         BIGINT,
  ok_2xx         BIGINT,
  redirect_3xx   BIGINT,
  client_4xx     BIGINT,
  server_5xx     BIGINT,
  avg_word_count NUMERIC
) AS $$
SELECT
  COUNT(*)                                                          AS total_count,
  COUNT(*) FILTER (WHERE page_type = 'blog')                       AS blog_count,
  COUNT(*) FILTER (WHERE page_type = 'product')                    AS product_count,
  COUNT(*) FILTER (WHERE page_type = 'service')                    AS service_count,
  COUNT(*) FILTER (WHERE page_type = 'landing')                    AS landing_count,
  COUNT(*) FILTER (WHERE page_type = 'about')                      AS about_count,
  COUNT(*) FILTER (WHERE page_type = 'contact')                    AS contact_count,
  COUNT(*) FILTER (WHERE page_type = 'other')                      AS other_count,
  COUNT(*) FILTER (WHERE has_geo_block = true)                     AS geo_yes,
  COUNT(*) FILTER (WHERE has_geo_block = false)                    AS geo_no,
  COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300) AS ok_2xx,
  COUNT(*) FILTER (WHERE status_code >= 300 AND status_code < 400) AS redirect_3xx,
  COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS client_4xx,
  COUNT(*) FILTER (WHERE status_code >= 500 AND status_code < 600) AS server_5xx,
  COALESCE(AVG(word_count), 0)::NUMERIC                            AS avg_word_count
FROM public.client_site_pages
WHERE public.client_site_pages.client_id = $1;
$$ LANGUAGE SQL STABLE SECURITY INVOKER;

-- Re-grant to service_role (SECURITY INVOKER still needs explicit grant for non-owners)
GRANT EXECUTE ON FUNCTION get_page_stats(UUID) TO service_role;
