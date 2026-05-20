-- client_portal_users: maps an email address to a client they can view in the portal
-- Admin adds rows manually (via Supabase SQL or future admin UI)
-- One email → one client (MVP: no multi-client support)

CREATE TABLE IF NOT EXISTS client_portal_users (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL,
  client_id    uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  display_name text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- Index for fast login lookup
CREATE INDEX IF NOT EXISTS client_portal_users_email_idx
  ON client_portal_users (lower(email));

-- RLS: service_role only (auth done server-side, not via anon client)
ALTER TABLE client_portal_users ENABLE ROW LEVEL SECURITY;
