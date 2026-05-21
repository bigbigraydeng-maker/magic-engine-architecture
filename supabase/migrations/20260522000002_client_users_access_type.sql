-- Add access_type to client_portal_users so one table covers both portal and dashboard access
-- Replaces CLIENT_VIEWERS env var for dashboard client-viewer permissions

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'portal'
    CHECK (access_type IN ('portal', 'dashboard', 'both'));

-- Existing rows are portal-only by default (no change in behaviour)
