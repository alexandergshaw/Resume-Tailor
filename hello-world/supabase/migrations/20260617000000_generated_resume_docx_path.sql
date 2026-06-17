-- Persist the finished .docx produced by the external Resume Tailor API.
--
-- The external engine renders its own document (the app only kept the extracted
-- text before), so on reload a tailored resume lost its faithful formatting.
-- docx_path points at an object in the existing `resumes` storage bucket at
-- `${user_id}/generated/${id}.docx`; downloads prefer it when present.
alter table public.generated_resumes
  add column if not exists docx_path text;
