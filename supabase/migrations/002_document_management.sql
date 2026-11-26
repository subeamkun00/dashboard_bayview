-- Run this AFTER 001_initial.sql on a fresh install. On the existing Bayview
-- project run ONLY this migration: document_files and the vector documents
-- table already exist. This migration preserves those tables and their data.
begin;

-- The original repository migration used documents for FILE metadata. The live
-- project uses document_files for files and documents for n8n vector chunks.
-- Rename only the old metadata-shaped table, never the live vector table.
do $$
begin
  if to_regclass('public.document_files') is null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'file_url')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'document_name') then
      alter table public.documents rename to document_files;
    else
      raise exception 'Expected the existing document_files metadata table. No duplicate storage table was created.';
    end if;
  end if;
end $$;

alter table public.document_files
  add column if not exists original_filename text,
  add column if not exists file_type text,
  add column if not exists department text,
  add column if not exists description text,
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists uploaded_by_name text,
  add column if not exists last_processed_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists chunks_count integer check (chunks_count >= 0),
  add column if not exists rag_source_id text;

update public.document_files
set original_filename = coalesce(original_filename, document_name),
    file_type = coalesce(file_type, nullif(lower(substring(file_url from '\.([A-Za-z0-9]+)$')), ''), nullif(lower(substring(document_name from '\.([A-Za-z0-9]+)$')), '')),
    rag_source_id = coalesce(rag_source_id, id::text);

-- Keep the historic Internal Policy value readable while accepting new values.
do $$ declare constraint_row record; allowed_values text; begin
  for constraint_row in select conname from pg_constraint where conrelid = 'public.document_files'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%document_type%' loop
    execute format('alter table public.document_files drop constraint %I', constraint_row.conname);
  end loop;
  select string_agg(quote_literal(category), ',') into allowed_values from (
    select unnest(array['SOP', 'Job Description', 'Internal Policy', 'Policy', 'Training', 'Other']) as category
    union select distinct document_type from public.document_files where document_type is not null
  ) categories;
  execute format('alter table public.document_files add constraint document_files_category_check check (document_type in (%s))', allowed_values);
end $$;
create index if not exists document_files_uploaded_idx on public.document_files(uploaded_at desc);
create index if not exists document_files_department_idx on public.document_files(department);
create unique index if not exists document_files_rag_source_idx on public.document_files(rag_source_id) where rag_source_id is not null;

create or replace function public.can_manage_knowledge_documents() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where id = (select auth.uid())); $$;
revoke all on function public.can_manage_knowledge_documents() from public;
grant execute on function public.can_manage_knowledge_documents() to authenticated;
alter table public.document_files enable row level security;
drop policy if exists "Workspace manages knowledge documents" on public.document_files;
create policy "Workspace manages knowledge documents" on public.document_files for all to authenticated
  using ((select public.can_manage_knowledge_documents())) with check ((select public.can_manage_knowledge_documents()));
revoke all on public.document_files from anon;
grant select, insert, update, delete on public.document_files to authenticated;

-- Reuse the existing private bucket. ON CONFLICT never overwrites an existing
-- bucket's configuration or deletes any storage objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-base', 'knowledge-base', false, 20971520,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;
drop policy if exists "Workspace reads knowledge originals" on storage.objects;
drop policy if exists "Workspace uploads knowledge originals" on storage.objects;
drop policy if exists "Workspace deletes knowledge originals" on storage.objects;
create policy "Workspace reads knowledge originals" on storage.objects for select to authenticated using (bucket_id = 'knowledge-base' and (select public.can_manage_knowledge_documents()));
create policy "Workspace uploads knowledge originals" on storage.objects for insert to authenticated with check (bucket_id = 'knowledge-base' and (select public.can_manage_knowledge_documents()));
create policy "Workspace deletes knowledge originals" on storage.objects for delete to authenticated using (bucket_id = 'knowledge-base' and (select public.can_manage_knowledge_documents()));

-- Link the EXISTING n8n vector rows, rather than creating a second chunk store.
-- Legacy Google Drive sources with unmatched file_ids are left untouched.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'embedding')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'metadata') then
    alter table public.documents add column if not exists source_document_id uuid references public.document_files(id) on delete cascade;
    execute $sql$update public.documents v set source_document_id = d.id from public.document_files d
      where v.source_document_id is null and (v.metadata->>'document_id' = d.id::text or v.metadata->>'file_id' = d.rag_source_id)$sql$;
    create index if not exists documents_source_document_idx on public.documents(source_document_id);
    create index if not exists documents_metadata_file_idx on public.documents((metadata->>'file_id'));
  end if;
end $$;

create or replace function public.link_knowledge_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_id uuid; source_key text;
begin
  source_key := coalesce(new.metadata->>'document_id', new.metadata->>'file_id');
  if source_key is not null then
    select id into source_id from public.document_files where id::text = source_key or rag_source_id = source_key order by (id::text = source_key) desc limit 1 for key share;
    if source_id is not null then
      new.source_document_id := source_id;
    elsif new.metadata ? 'document_id' then
      raise exception 'Knowledge source does not exist. Abort this processing job.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.link_knowledge_source() from public;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_document_id') then
    drop trigger if exists link_knowledge_source on public.documents;
    create trigger link_knowledge_source before insert or update of metadata, source_document_id on public.documents for each row execute function public.link_knowledge_source();
  end if;
end $$;

-- Capture completion/error metadata when the EXISTING workflow updates status.
create or replace function public.track_knowledge_processing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare chunk_total integer; embedding_total integer;
begin
  new.rag_source_id := coalesce(new.rag_source_id, new.id::text);
  if new.processing_status = 'processing' and old.processing_status is distinct from 'processing' then
    new.processing_started_at := now();
    new.processing_error := null;
  elsif new.processing_status = 'ready' and old.processing_status is distinct from 'ready' then
    new.last_processed_at := now();
    new.processing_started_at := null;
    new.processing_error := null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_document_id') then
      execute 'select count(*), count(embedding) from public.documents where source_document_id = $1' into chunk_total, embedding_total using new.id;
      if chunk_total > 0 then new.chunks_count := chunk_total; new.embeddings_count := embedding_total; end if;
    end if;
    if chunk_total is null or chunk_total = 0 then
      if to_regclass('public.document_embeddings') is not null then
        execute 'select count(*), count(embedding) from public.document_embeddings where document_id::text = $1' into chunk_total, embedding_total using new.id::text;
        if chunk_total > 0 then new.chunks_count := chunk_total; new.embeddings_count := embedding_total; end if;
      end if;
    end if;
  elsif new.processing_status = 'failed' then
    new.processing_started_at := null;
  end if;
  return new;
end $$;
revoke all on function public.track_knowledge_processing() from public;
drop trigger if exists track_knowledge_processing on public.document_files;
create trigger track_knowledge_processing before update on public.document_files for each row execute function public.track_knowledge_processing();

-- Metadata and vector deletion are one transaction. Never match by document
-- title: different files can share a name. Unmapped legacy sources are blocked
-- until their rag_source_id is set to the actual metadata.file_id.
create or replace function public.delete_knowledge_document(p_document_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare target public.document_files%rowtype; removed_count integer := 0; affected integer;
begin
  if not public.can_manage_knowledge_documents() then raise exception 'Administrator access required.'; end if;
  select * into target from public.document_files where id = p_document_id for update;
  if not found then raise exception 'Document not found.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_document_id') then
    execute $sql$delete from public.documents where source_document_id = $1 or metadata->>'document_id' = $1::text or metadata->>'file_id' = $2$sql$ using target.id, coalesce(target.rag_source_id, target.id::text);
    get diagnostics affected = row_count; removed_count := removed_count + affected;
  end if;
  if to_regclass('public.document_embeddings') is not null then
    execute 'delete from public.document_embeddings where document_id::text = $1' using target.id::text;
    get diagnostics affected = row_count; removed_count := removed_count + affected;
  end if;
  if removed_count = 0 and (target.embeddings_count > 0 or target.processing_status = 'ready') then
    raise exception 'This legacy source is not linked to its vector records. Set rag_source_id to the existing metadata.file_id before deleting.';
  end if;
  delete from public.document_files where id = target.id;
  return target.file_url;
end $$;
revoke all on function public.delete_knowledge_document(uuid) from public;
grant execute on function public.delete_knowledge_document(uuid) to authenticated;

-- Add realtime only if it is not already enabled for this table.
do $$ begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_files') then
    alter publication supabase_realtime add table public.document_files;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
