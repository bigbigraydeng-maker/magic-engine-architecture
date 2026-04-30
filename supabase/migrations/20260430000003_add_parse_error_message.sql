-- ============================================================
-- Add parse_error_message to ai_visibility_runs
-- Tracks parser failures when brand extraction from raw_response
-- succeeds at the HTTP level but yields no usable structured data.
--
-- Distinct from error_message (which records LLM/network errors).
-- NULL = parser ran cleanly; non-NULL = parser warning/error text.
--
-- Reference: ARCHITECTURE.md §12, ROADMAP.md P7.1
-- ============================================================

ALTER TABLE ai_visibility_runs
  ADD COLUMN IF NOT EXISTS parse_error_message text DEFAULT NULL;
