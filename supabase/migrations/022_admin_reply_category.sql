-- 022_admin_reply_category.sql
-- Answers saved from admin replies (migration 021) get their own document
-- category, "Admin Reply", so the Documents page can list them in an
-- "Admin replies" group of their own.
-- Also moves the answers saved earlier (named "คำตอบจากเจ้าหน้าที่: ...") into
-- that category and renames them. Nothing is deleted. Safe to re-run.
begin;

do $$
declare
  constraint_row record;
  allowed_values text;
begin
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.document_files'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%document_type%'
  loop
    execute format('alter table public.document_files drop constraint %I', constraint_row.conname);
  end loop;
  select string_agg(quote_literal(category), ',') into allowed_values from (
    select unnest(array['SOP', 'Job Description', 'Internal Policy', 'Policy', 'Training', 'Other', 'Admin Reply']) as category
    union select distinct document_type from public.document_files where document_type is not null
  ) categories;
  execute format('alter table public.document_files add constraint document_files_category_check check (document_type in (%s))', allowed_values);
end $$;

-- The ".txt" ending stays: the n8n document workflow reads the format from it.
update public.document_files
   set document_type = 'Admin Reply',
       document_name = replace(document_name, 'คำตอบจากเจ้าหน้าที่', 'คำตอบจากแอดมิน')
 where document_name like 'คำตอบจากเจ้าหน้าที่:%';

commit;
