-- Public bucket for TradeMe image proxy (server uploads with authenticated user session).
-- Apply in Supabase Dashboard SQL Editor or `supabase db push`.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-images',
  'listing-images',
  true,
  6291456,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "listing_images_public_read" ON storage.objects;
CREATE POLICY "listing_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'listing-images');

DROP POLICY IF EXISTS "listing_images_authenticated_insert" ON storage.objects;
CREATE POLICY "listing_images_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images');

DROP POLICY IF EXISTS "listing_images_authenticated_delete" ON storage.objects;
CREATE POLICY "listing_images_authenticated_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images');
