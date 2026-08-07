-- ─────────────────────────────────────────────────────────────────────────────
-- flywheel_outcomes: stable business identity — STEP 1 of 2, EXPAND
-- Issue #859 · Attribution Correctness Work Package
--
-- ROLLOUT ORDER — this file is deliberately backward compatible:
--
--     [1] apply THIS migration        ← old main writers keep working
--     [2] deploy the new writers      ← they start filling evaluator_key
--     [3] apply 20260808000002_..._contract.sql   ← only once no NULLs remain
--
--   Nothing here may break the writers currently running on main. Those two
--   writers INSERT without an `evaluator_key`, so this migration adds the column
--   NULLABLE and never sets NOT NULL. Tightening happens in step 3, guarded.
--
--   The UNIQUE constraint is added here rather than in step 3 because the new
--   writers' `upsert(... onConflict: 'action_id,metric_key,window_days')` cannot
--   run without it — and the old writers (DELETE-then-INSERT, which can never
--   leave two rows on one key) are unaffected by it.
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
--   accept a caller-supplied window. action_id, metric_key and window_days are
--   all already NOT NULL, so the UNIQUE has no NULL-bypass semantics.
--
--   evaluator_key is deliberately NOT in the key: two evaluators answering the
--   same (action, metric, window) question are competing answers to ONE fact,
--   not two facts. It is recorded as an attribute so that each writer can
--   reconcile its own rows and never the other writer's.
--
-- THIS MIGRATION DELETES NOTHING. It contains no DELETE statement at all: if the
-- data is not in a state the constraint accepts, it aborts and leaves the table
-- untouched for a human to decide. Removing rows is a separate, PM-authorised act.
--
-- Reference: https://github.com/bigbigraydeng-maker/magic-engine/issues/859
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. evaluator_key: which pipeline produced this row ───────────────────────
--
-- NULLABLE and no DEFAULT, both on purpose:
--   * nullable  → the writers running on main today INSERT without this column
--                 and must keep working between step [1] and step [2];
--   * no DEFAULT → a writer must declare which evaluator it is rather than
--                 silently inheriting someone else's label. A DEFAULT would
--                 also make the step [3] guard meaningless, because old rows
--                 would look filled in without any writer having said so.

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS evaluator_key TEXT;

-- Backfill: BEST-EFFORT HISTORICAL INFERENCE, not proven provenance.
--
-- The seo.gsc.* namespace has in practice only ever been written by the GSC
-- bridge, so this is the best label available for rows written before the column
-- existed. It is NOT proof of which writer produced them, and it will stop being
-- a safe inference the moment a flywheel_action carries a seo.gsc.* key as its
-- expected_metric — at which point job.ts writes that namespace too. Rows written
-- from step [2] onward carry the label the writer itself declared; do not read
-- these backfilled values as if they had the same authority.
UPDATE flywheel_outcomes
   SET evaluator_key = CASE
         WHEN metric_key LIKE 'seo.gsc.%' THEN 'gsc_snapshots'
         ELSE 'flywheel_metrics'
       END
 WHERE evaluator_key IS NULL;

-- CHECK admits NULL on purpose: a SQL CHECK passes on NULL, so this constrains
-- the vocabulary without blocking the old writers' NULL inserts. Step [3]
-- narrows it once NOT NULL lands.
ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_key_check;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_key_check
  CHECK (evaluator_key IS NULL OR evaluator_key IN ('flywheel_metrics', 'gsc_snapshots'));

COMMENT ON COLUMN flywheel_outcomes.evaluator_key IS
  'Which attribution pipeline computed this row: flywheel_metrics (attribution/job.ts) '
  'or gsc_snapshots (attribution/gsc-bridge.ts). Not part of the natural key — it exists '
  'so each writer reconciles only its own rows. NULL only for rows written by pre-#859 '
  'code during the expand→deploy window; historical values are inferred, not declared.';

-- ── 2. Duplicate preflight — fail closed, never delete ───────────────────────
--
-- Production preflight before writing this migration returned 0 duplicate groups
-- on (action_id, metric_key, window_days), so this block is expected to pass
-- silently. If the data has moved since, the migration ABORTS: collapsing rows
-- would be an unauthorised, irreversible deletion of client-derived data, and
-- "which row survives" is a reconciliation policy decision, not a schema one.

DO $$
DECLARE
  dup_groups INT;
  dup_rows   INT;
BEGIN
  SELECT count(*), COALESCE(sum(n), 0)
    INTO dup_groups, dup_rows
    FROM (
      SELECT count(*) AS n
        FROM flywheel_outcomes
       GROUP BY action_id, metric_key, window_days
      HAVING count(*) > 1
    ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'raise_exception',
      MESSAGE = format(
        'flywheel_outcomes: %s duplicate (action_id, metric_key, window_days) group(s) covering %s row(s)',
        dup_groups, dup_rows),
      DETAIL  = 'The UNIQUE constraint cannot be added while duplicates exist, and this '
                'migration will not delete rows to make room for it.',
      HINT    = 'Run the preflight query, decide which row survives, and get that cleanup '
                'authorised separately: SELECT action_id, metric_key, window_days, count(*) '
                'FROM flywheel_outcomes GROUP BY 1,2,3 HAVING count(*) > 1;';
  END IF;

  RAISE NOTICE 'flywheel_outcomes: 0 duplicate (action_id, metric_key, window_days) groups — safe to add UNIQUE';
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
-- and drifting from one another. All three inputs are NOT NULL, so this is
-- always defined.

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS outcome_key TEXT
  GENERATED ALWAYS AS (
    action_id::text || ':' || metric_key || ':' || window_days::text
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_flywheel_outcomes_outcome_key
  ON flywheel_outcomes(outcome_key);

COMMENT ON COLUMN flywheel_outcomes.outcome_key IS
  'Canonical handle for the natural key (action_id:metric_key:window_days). Derived — never written directly.';

-- ── 4. Let PostgREST see the new columns ─────────────────────────────────────
-- Without this the API layer can keep serving a cached schema, and the newly
-- deployed writers get "column evaluator_key does not exist" on their first run.

NOTIFY pgrst, 'reload schema';
