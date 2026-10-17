-- Reviewable prerequisite only. Not an automatically deployed migration.
-- Run only through separately authorized database administration; safe to repeat.
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS tailoring_document_mode text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_searches_tailoring_document_mode_check'
      AND conrelid = 'public.saved_searches'::regclass
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_tailoring_document_mode_check
      CHECK (tailoring_document_mode IS NULL OR tailoring_document_mode IN ('resume_only', 'resume_cover'));
  END IF;
END $$;
-- No backfill: NULL retains historical resume plus optional cover behavior.
