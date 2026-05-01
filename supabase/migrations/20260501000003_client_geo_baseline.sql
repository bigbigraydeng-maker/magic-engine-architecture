-- Migration: Add GEO intervention baseline tracking to clients
-- Reference: ROADMAP.md P7.4.13
--
-- Adds geo_intervention_start so monthly reports can calculate
-- "before vs after GEO deployment" rankings.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS geo_intervention_start DATE;

COMMENT ON COLUMN clients.geo_intervention_start IS
  'Date GEO directive + blog content was first deployed for this client. '
  'Used as the before/after dividing line in monthly AI visibility reports.';

-- Set baseline for CTS Tours (first GEO deployment: 2026-05-01)
UPDATE clients
SET geo_intervention_start = '2026-05-01'
WHERE id = 'c0000000-0000-0000-0000-000000000000';
