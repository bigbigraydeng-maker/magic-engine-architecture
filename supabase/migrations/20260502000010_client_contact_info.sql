-- Add contact information and industry fields to clients table
-- Replaces the Airtable-centric onboarding with client contact collection

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS industry       text,
  ADD COLUMN IF NOT EXISTS contact_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;
