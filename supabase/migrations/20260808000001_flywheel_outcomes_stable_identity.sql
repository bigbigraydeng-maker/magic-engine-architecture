-- ─────────────────────────────────────────────────────────────────────────────
-- flywheel_outcomes: stable business identity + writer isolation
-- Issue #859 · Memory-B / Attribution Correctness Work Package
--
-- WHY (all figures measured against production glbdnayojixmexgofbsd on 2026-08-08,
--      not assumed):
--
--   flywheel_outcomes has TWO independent writers:
--
--     src/lib/flywheel/attribution/job.ts
--       → 1 row per action, metric_key = flywheel_actions.expected_metric,
--         window_days default 14 (overridable via the cron route's ?window_days=)
--       → reconciled with  DELETE WHERE action_id = ?   ← no metric_key scope
--
--     src/lib/flywheel/attribution/gsc-bridge.ts
--       → 3 rows per action (seo.gsc.clicks / impressions / avg_position, or the
--         three page-scoped equivalents), window_days default 28 (overridable
--         1..90 via POST /api/clients/[id]/flywheel/gsc-attribution)
--       → reconciled with  DELETE WHERE action_id = ? AND metric_key IN (...)
--
--   Both ran DELETE-then-INSERT, so:
--     1. flywheel_outcomes.id changed on every 6-hourly cron tick — no downstream
--        consumer could hold a stable reference to "the same business outcome";
--     2. job.ts's unscoped DELETE could destroy gsc-bridge's rows (latent today
--        only because no live SEO action's expected_metric has matching
--        flywheel_metrics data — flywheel_metrics DOES already carry
--        seo.gsc.clicks / impressions / avg_position, 99 rows each, so the fuse
--        is armed);
--     3. gsc-bridge DELETEd before INSERTing, so a failed insert left the action
--        with no outcomes at all until the next successful run.
--
-- NATURAL KEY — proven, not assumed:
--
--   candidate                            duplicate groups in production
--   ──────────────────────────────────── ──────────────────────────────
--   action_id                            62   ❌ rejected outright
--   action_id, metric_key                 0   ⚠️  passes today only because the
--                                             two writers happen to use disjoint
--                                             metric_key namespaces AND run at
--                                             different windows; both are
--                                             coincidences, not invariants
--   action_id, metric_key, window_days    0   ✅ adopted
--
--   window_days belongs in the key because the same metric legitimately carries
--   two live windows (14 and 28 both present in production) and both writers
--   accept a caller-supplied window.
--
--   evaluator_key is deliberately NOT in the key: two evaluators answering the
--   same (action, metric, window) question are competing answers to ONE fact,
--   not two facts. It is recorded as an attribute so that each writer can
--   reconcile its own rows and never the other writer's.
--
-- Reference: https://github.com/bigbigraydeng-maker/magic-engine/issues/859
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. evaluator_key: which pipeline produced this row ───────────────────────

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS evaluator_key TEXT;

-- Backfill from the metric namespace. The GSC bridge is the only writer that
-- has ever emitted a seo.gsc.* key; everything else came from job.ts reading
-- flywheel_metrics.
UPDATE flywheel_outcomes
   SET evaluator_key = CASE
         WHEN metric_key LIKE 'seo.gsc.%' THEN 'gsc_snapshots'
         ELSE 'flywheel_metrics'
       END
 WHERE evaluator_key IS NULL;

-- No DEFAULT on purpose: a future writer must declare which evaluator it is
-- rather than silently inheriting someone else's label.
ALTER TABLE flywheel_outcomes
  ALTER COLUMN evaluator_key SET NOT NULL;

ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_key_check;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_key_check
  CHECK (evaluator_key IN ('flywheel_metrics', 'gsc_snapshots'));

COMMENT ON COLUMN flywheel_outcomes.evaluator_key IS
  'Which attribution pipeline computed this row: flywheel_metrics (attribution/job.ts) '
  'or gsc_snapshots (attribution/gsc-bridge.ts). Not part of the natural key — it exists '
  'so each writer reconciles only its own rows.';

-- ── 2. Duplicate preflight, then the unique constraint ───────────────────────
--
-- Production preflight before writing this migration returned 0 duplicate groups
-- on (action_id, metric_key, window_days), so the block below is expected to be
-- a no-op there. It is kept as a guard so the migration is safe in any
-- environment: without it, ADD CONSTRAINT would abort the whole transaction.
--
-- Deleting a strict duplicate loses nothing: every flywheel_outcomes row is
-- fully derived and is recomputed from flywheel_metrics / gsc_performance_snapshots
-- on the next attribution run. The newest row per key is the one kept.

DO $$
DECLARE
  dup_groups INT;
  removed    INT;
BEGIN
  SELECT count(*) INTO dup_groups
    FROM (
      SELECT action_id, metric_key, window_days
        FROM flywheel_outcomes
       GROUP BY 1, 2, 3
      HAVING count(*) > 1
    ) d;

  IF dup_groups = 0 THEN
    RAISE NOTICE 'flywheel_outcomes: 0 duplicate (action_id, metric_key, window_days) groups — no cleanup needed';
  ELSE
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY action_id, metric_key, window_days
               ORDER BY computed_at DESC, created_at DESC, id DESC
             ) AS rn
        FROM flywheel_outcomes
    )
    DELETE FROM flywheel_outcomes o
     USING ranked r
     WHERE o.id = r.id AND r.rn > 1;

    GET DIAGNOSTICS removed = ROW_COUNT;
    RAISE NOTICE 'flywheel_outcomes: collapsed % duplicate group(s), removed % superseded row(s)',
      dup_groups, removed;
  END IF;
END $$;

ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_natural_key;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_natural_key
  UNIQUE (action_id, metric_key, window_days);

COMMENT ON CONSTRAINT flywheel_outcomes_natural_key ON flywheel_outcomes IS
  'Stable business identity of an outcome: the measured effect of one action on one metric '
  'over one window. Upsert target for both attribution writers — see '
  'src/lib/flywheel/attribution/outcome-identity.ts.';

-- ── 3. outcome_key: the natural key as one readable handle ───────────────────
--
-- Generated + STORED so downstream consumers (memory extraction, reporting)
-- reference one canonical string instead of each re-deriving the concatenation
-- and drifting from one another.

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS outcome_key TEXT
  GENERATED ALWAYS AS (
    action_id::text || ':' || metric_key || ':' || window_days::text
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_flywheel_outcomes_outcome_key
  ON flywheel_outcomes(outcome_key);

COMMENT ON COLUMN flywheel_outcomes.outcome_key IS
  'Canonical handle for the natural key (action_id:metric_key:window_days). Derived — never written directly.';
