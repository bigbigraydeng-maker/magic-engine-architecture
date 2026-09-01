-- WhatsApp inbound routing key — mirrors clients.facebook_page_id exactly
-- (20260726000001_messenger_conversations.sql).
--
-- The webhook receiver gets a `phone_number_id` from Meta on every inbound
-- message and must resolve it to a client_id without hardcoding any client's
-- id in shared code (张良 platform-tier-gate 红线 2 — no client fact in
-- shared runtime). A per-client column is the same shape already proven for
-- Messenger's page_id → client_id mapping; not a new pattern.
--
-- No RLS change: this only adds a column to the existing `clients` table,
-- whose policy already covers all columns.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT;

COMMENT ON COLUMN clients.whatsapp_phone_number_id IS
  'WhatsApp Cloud API Phone Number ID (numeric, from Meta Business Manager after the number is shared into the Magic Engine business portfolio — see #1300). When set, the WhatsApp webhook routes inbound messages for this number to this client.';

CREATE UNIQUE INDEX IF NOT EXISTS clients_whatsapp_phone_number_id_key
  ON clients (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;
