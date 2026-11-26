-- 023_accessible_documents.sql
-- Lets the LINE assistant offer the ORIGINAL file of a document (PDF, TXT...)
-- to an employee, using the same access rule as the AI search
-- (match_documents_scoped): their own position, their whole department, the
-- whole hotel, or - for department heads - everything in their department.
--
-- Only the service role (the document-link Edge Function) can call it. Answers
-- saved from admin replies are never offered as files. Safe to re-run.
begin;

create or replace function public.accessible_documents(
  p_department text,
  p_position text,
  p_head boolean default false
)
returns table (
  id uuid,
  document_name text,
  original_filename text,
  file_url text,
  file_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.document_name, d.original_filename, d.file_url, d.file_type
  from public.document_files d
  where d.processing_status = 'ready'
    and coalesce(d.document_type, '') <> 'Admin Reply'
    and d.file_url is not null
    and nullif(p_department, '') is not null
    and (
      -- written for the employee's own position
      (nullif(p_position, '') is not null
       and public.norm_text(d.position) = public.norm_text(p_position))
      -- or for every position of the employee's department, or the whole hotel
      or (public.norm_text(d.position) = ''
          and (public.norm_dept(d.department) = public.norm_dept(p_department)
               or public.norm_text(d.department) in ('all', 'company', 'all departments')))
      -- department heads: every document of their own department
      or (coalesce(p_head, false)
          and public.norm_dept(d.department) = public.norm_dept(p_department))
    );
$$;

revoke all on function public.accessible_documents(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.accessible_documents(text, text, boolean)
  to service_role;

commit;
