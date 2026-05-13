-- P8.5.16: Extend execution_items with phase + steps_json columns
-- phase: which prescription phase this item belongs to (1, 2, or 3)
-- steps_json: structured instructions for me_auto / fde_manual / third_party items

ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS phase SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS steps_json JSONB;

-- Index for phase-grouped display on the execution board
CREATE INDEX IF NOT EXISTS idx_execution_items_prescription_phase
  ON execution_items(prescription_id, phase, sort_order);
