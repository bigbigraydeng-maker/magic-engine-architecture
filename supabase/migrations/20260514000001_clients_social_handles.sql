-- Add Facebook page URL and TikTok handle to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS facebook_page_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_handle     TEXT;
