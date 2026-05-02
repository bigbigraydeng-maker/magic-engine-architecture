-- Allow 'upload' as a valid provider for manual file uploads
-- Previously only 'wavespeed' and 'seedance' were allowed

ALTER TABLE public.visual_assets
  DROP CONSTRAINT IF EXISTS visual_assets_provider_check;

ALTER TABLE public.visual_assets
  ADD CONSTRAINT visual_assets_provider_check
  CHECK (provider IN ('wavespeed', 'seedance', 'heygen', 'upload'));
