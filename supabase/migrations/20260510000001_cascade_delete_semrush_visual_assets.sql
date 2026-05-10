-- Fix ON DELETE behaviour for two tables that were missing CASCADE.
-- All 25 child tables referencing clients(id) now use ON DELETE CASCADE,
-- so deleting a client row removes all associated data in one operation.

-- semrush_usage_logs: NO ACTION → CASCADE
ALTER TABLE public.semrush_usage_logs
  DROP CONSTRAINT semrush_usage_logs_client_id_fkey,
  ADD CONSTRAINT semrush_usage_logs_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- visual_assets: NO ACTION → CASCADE
ALTER TABLE public.visual_assets
  DROP CONSTRAINT visual_assets_client_id_fkey,
  ADD CONSTRAINT visual_assets_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
