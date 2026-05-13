-- P8.5.26: Track which dimensions were skipped due to missing prerequisite data.
-- Skipped dimensions are excluded from overall_score weighting (handled in
-- computeOverallScore) and rendered as "Not configured" in the UI, instead
-- of silently treated as 0 (which artificially deflates scores) or fully
-- counted (which artificially inflates scores).

ALTER TABLE diagnostic_runs
  ADD COLUMN IF NOT EXISTS dimensions_skipped diagnostic_dimension[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN diagnostic_runs.dimensions_skipped IS
  'Dimensions excluded from overall_score because prerequisite data was missing (e.g. no keywords configured, business not on Google). UI renders these as "Not configured" instead of 0.';
