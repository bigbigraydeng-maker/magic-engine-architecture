-- Fix: website free-discovery funnel (magicengine.com.au/discover) has captured
-- zero leads since launch. website/functions/api/scout.js intentionally inserts
-- a discovery_leads row BEFORE email is known (email is collected two steps
-- later via /api/report), but the original 20260521000002 migration declared
-- email NOT NULL and it was never relaxed. Every scout insert has been failing
-- the NOT NULL check, silently falling back to a synthetic lead id, which then
-- makes /api/report refuse to ever send the promised report.
-- Verified in production (glbdnayojixmexgofbsd, 2026-09-02): discovery_leads
-- has 0 rows despite the feature being live.

ALTER TABLE discovery_leads
  ALTER COLUMN email DROP NOT NULL;
