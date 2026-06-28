-- ----------------------------------------------------------------------------
-- 021: Festival stat label overrides
-- ----------------------------------------------------------------------------
-- For early-announce / pre-lineup stage when the live event count would just
-- show "0 acts". Admin can set a literal label like "100+" or "Over 50" that
-- the landing page uses instead of the computed number.
-- Null → use the live count.

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS act_count_label   text;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS venue_count_label text;
