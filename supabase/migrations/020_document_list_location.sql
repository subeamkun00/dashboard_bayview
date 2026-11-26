-- 020_document_list_location.sql
-- Where a document is LISTED (department / position on the Documents page) is
-- now separate from WHO CAN ASK about it.
--
-- A "Whole hotel" document keeps department = 'All departments', so the AI
-- search (match_documents_scoped) still lets every employee get answers from
-- it. These two columns only control which department / position list it
-- appears in on the dashboard. The AI search does not read them.
-- Safe to re-run. Nothing is deleted.
begin;

alter table public.document_files
  add column if not exists list_department text,
  add column if not exists list_position text;

commit;
