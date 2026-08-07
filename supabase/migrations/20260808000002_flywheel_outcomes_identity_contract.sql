-- ─────────────────────────────────────────────────────────────────────────────
-- flywheel_outcomes: stable business identity — STEP 2 of 2, CONTRACT
-- Issue #859 · Attribution Correctness Work Package
--
-- ROLLOUT ORDER:
--
--     [1] 20260808000001_flywheel_outcomes_identity_expand.sql
--     [2] deploy the new writers (they declare evaluator_key on every write)
--     [3] apply THIS migration   ← only once every row has an evaluator_key
--
-- DO NOT apply this together with step [1], and do not apply it as part of the
-- deploy that ships the new writers. Between [1] and [2] the old writers are
-- still inserting rows without an evaluator_key; running this before they have
-- all been replaced would break attribution outright.
--
-- This migration is fail-closed: if any row still has a NULL evaluator_key it
-- aborts and changes nothing. It never guesses a value and never deletes a row —
-- a NULL at this point means either the deploy has not fully rolled out, or some
-- writer nobody has accounted for is still inserting. Both are things a person
-- needs to look at, not something a migration should paper over.
--
-- Readiness check (run it yourself before applying):
--
--   SELECT count(*) FROM flywheel_outcomes WHERE evaluator_key IS NULL;   -- must be 0
--
-- Reference: https://github.com/bigbigraydeng-maker/magic-engine/issues/859
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count  INT;
  oldest_null TIMESTAMPTZ;
BEGIN
  SELECT count(*), min(computed_at)
    INTO null_count, oldest_null
    FROM flywheel_outcomes
   WHERE evaluator_key IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'raise_exception',
      MESSAGE = format(
        'flywheel_outcomes: %s row(s) still have a NULL evaluator_key (oldest computed_at %s)',
        null_count, oldest_null),
      DETAIL  = 'Rows without an evaluator_key were written by a writer that does not '
                'declare one — either the #859 writers are not fully deployed yet, or a '
                'writer nobody has accounted for is still inserting.',
      HINT    = 'Confirm the new attribution writers are live, let one attribution cron '
                'cycle complete, then re-check: SELECT count(*) FROM flywheel_outcomes '
                'WHERE evaluator_key IS NULL;';
  END IF;

  RAISE NOTICE 'flywheel_outcomes: 0 rows with NULL evaluator_key — safe to tighten';
END $$;

ALTER TABLE flywheel_outcomes
  ALTER COLUMN evaluator_key SET NOT NULL;

-- Narrow the vocabulary check now that NULL is no longer reachable. Kept as an
-- explicit constraint rather than an enum so a new evaluator has to arrive via a
-- migration someone reviews.
ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_key_check;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_key_check
  CHECK (evaluator_key IN ('flywheel_metrics', 'gsc_snapshots'));

-- Same narrowing for the ownership rule: NULL is no longer reachable, so the
-- escape hatch that let the pre-#859 writers through comes out.
ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_owns_metric;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_owns_metric
  CHECK (
    evaluator_key = CASE
      WHEN metric_key LIKE 'seo.gsc.%' THEN 'gsc_snapshots'
      ELSE 'flywheel_metrics'
    END
  );

COMMENT ON COLUMN flywheel_outcomes.evaluator_key IS
  'Which attribution pipeline computed this row: flywheel_metrics (attribution/job.ts) '
  'or gsc_snapshots (attribution/gsc-bridge.ts). Not part of the natural key — it exists '
  'so each writer reconciles only its own rows. Required: every writer declares its own.';

NOTIFY pgrst, 'reload schema';
