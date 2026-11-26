-- 021_staff_answer_learning.sql
-- When an admin answers a fallback question in the dashboard, the Q&A can be saved
-- as a small knowledge document (document_files + vectors, the same path as an
-- uploaded file). The assistant then answers the same question next time.
-- This column remembers which document belongs to which conversation, so a
-- follow-up admin reply updates that document instead of creating a new one.
-- If the document is deleted from the Documents page, the link is cleared.
-- Safe to re-run.
begin;

alter table public.chat_logs
  add column if not exists learned_document_id uuid
  references public.document_files(id) on delete set null;

commit;
