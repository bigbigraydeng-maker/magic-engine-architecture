-- Campaign-level visual inputs for Visual Direction generation
-- vi_input_notes: user-typed visual elements for this campaign (colors, themes, special requirements)
-- vi_input_file_urls: uploaded visual reference files (moodboards, design briefs, campaign creative docs)
ALTER TABLE campaign_briefs
  ADD COLUMN IF NOT EXISTS vi_input_notes TEXT,
  ADD COLUMN IF NOT EXISTS vi_input_file_urls TEXT[] DEFAULT '{}';
