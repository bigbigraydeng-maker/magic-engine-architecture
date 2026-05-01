-- P8.1 — Add onboarding_completed_at to clients
-- Tracks when a client completed the 3-step onboarding wizard.
-- This column is set by the Step 3 handler in /api/clients/onboarding.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

COMMENT ON COLUMN public.clients.onboarding_completed_at IS
  'Timestamp when the client completed the onboarding wizard (Step 3). NULL means onboarding is incomplete.';
