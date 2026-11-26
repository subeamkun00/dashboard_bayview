-- 010_document_positions.sql
-- Documents belong to a department AND (optionally) one position. The AI then
-- only searches documents that match the asking employee's position, plus the
-- documents marked "all positions" for their department and company-wide ones.
-- Run after 002 and 008. Safe to re-run. Nothing is deleted.
begin;

do $$ begin
  if to_regclass('public.document_files') is null then
    raise exception 'Run 002_document_management.sql first. Nothing was changed.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'document_files'
         and column_name in ('department', 'rag_source_id', 'processing_status')) < 3 then
    raise exception 'document_files is missing columns (department / rag_source_id / processing_status). Run 002_document_management.sql first, then run this file again. Nothing was changed.';
  end if;
  if to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
end $$;

-- 1) The position a document is written for (null = every position of the department)
alter table public.document_files add column if not exists position text;
create index if not exists document_files_scope_idx on public.document_files (department, position);

-- 2) Every chunk carries the department and position of its document, set from
--    the Documents page (the n8n workflow does not need to know about it).
create or replace function public.link_knowledge_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_id uuid; source_key text; v_dep text; v_pos text;
begin
  source_key := coalesce(new.metadata->>'document_id', new.metadata->>'file_id');
  if source_key is not null then
    select id, department, position into source_id, v_dep, v_pos
      from public.document_files
     where id::text = source_key or rag_source_id = source_key
     order by (id::text = source_key) desc limit 1 for key share;
    if source_id is not null then
      new.source_document_id := source_id;
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
             'department', coalesce(nullif(v_dep, ''), new.metadata->>'department', ''),
             'position', coalesce(v_pos, ''));
    elsif new.metadata ? 'document_id' then
      raise exception 'Knowledge source does not exist. Abort this processing job.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.link_knowledge_source() from public;
-- Make sure the trigger itself is attached to the chunk table.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'documents' and column_name = 'source_document_id') then
    drop trigger if exists link_knowledge_source on public.documents;
    create trigger link_knowledge_source before insert or update of metadata, source_document_id
      on public.documents for each row execute function public.link_knowledge_source();
  end if;
end $$;

-- 3) Moving a document to another department/position updates its chunks at once.
create or replace function public.sync_knowledge_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.department is distinct from old.department or new.position is distinct from old.position)
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'documents'
                   and column_name = 'source_document_id') then
    execute 'update public.documents set metadata = coalesce(metadata, ''{}''::jsonb) || jsonb_build_object(''department'', $1::text, ''position'', $2::text) where source_document_id = $3'
      using coalesce(new.department, ''), coalesce(new.position, ''), new.id;
  end if;
  return new;
end $$;
revoke all on function public.sync_knowledge_scope() from public;
drop trigger if exists sync_knowledge_scope on public.document_files;
create trigger sync_knowledge_scope after update of department, position on public.document_files
  for each row execute function public.sync_knowledge_scope();

-- 3b) Reprocessing replaces a document's old chunks instead of adding duplicates:
--     they are removed when the dashboard marks the document "processing".
create or replace function public.reset_knowledge_chunks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.processing_status = 'processing' and old.processing_status is distinct from 'processing'
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'documents'
                   and column_name = 'source_document_id') then
    execute 'delete from public.documents where source_document_id = $1' using new.id;
  end if;
  return new;
end $$;
revoke all on function public.reset_knowledge_chunks() from public;
drop trigger if exists reset_knowledge_chunks on public.document_files;
create trigger reset_knowledge_chunks after update of processing_status on public.document_files
  for each row execute function public.reset_knowledge_chunks();

-- 4) Link chunks that were saved without their document, then tag all chunks
--    (position stays empty = whole department).
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'documents' and column_name = 'source_document_id') then
    update public.documents v set source_document_id = f.id
      from public.document_files f
     where v.source_document_id is null
       and v.metadata ? 'document_id'
       and f.id::text = v.metadata->>'document_id';
    update public.documents v
       set metadata = coalesce(v.metadata, '{}'::jsonb)
         || jsonb_build_object(
              'department', coalesce(nullif(d.department, ''), v.metadata->>'department', ''),
              'position', coalesce(d.position, ''))
      from public.document_files d
     where v.source_document_id = d.id;
  end if;
end $$;

-- 5) The search the AI uses (n8n: Supabase Vector Store -> Query Name).
--    Built for the real column types of your documents table.
do $$
declare
  id_type text; emb_type text; vec_schema text;
begin
  if to_regclass('public.documents') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'documents' and column_name = 'embedding') then
    raise notice 'No vector table public.documents found: match_documents_scoped was not created.';
    return;
  end if;
  select format_type(a.atttypid, a.atttypmod) into id_type from pg_attribute a
   where a.attrelid = 'public.documents'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into emb_type from pg_attribute a
   where a.attrelid = 'public.documents'::regclass and a.attname = 'embedding' and not a.attisdropped;
  select n.nspname into vec_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';
  execute format($f$
    create or replace function public.match_documents_scoped(
      query_embedding %1$s, match_count int default 10, filter jsonb default '{}'::jsonb)
    returns table (id %2$s, content text, metadata jsonb, similarity double precision)
    language sql stable security definer set search_path = ''
    as $body$
      select d.id, d.content, d.metadata,
             (1 - (d.embedding operator(%3$I.<=>) query_embedding))::double precision
      from public.documents d
      where nullif(filter->>'department', '') is not null
        and (
          -- written for the employee's own position
          (nullif(filter->>'position', '') is not null
           and public.norm_text(d.metadata->>'position') = public.norm_text(filter->>'position'))
          -- or for every position of the employee's department, or the whole hotel
          or (public.norm_text(d.metadata->>'position') = ''
              and (public.norm_dept(d.metadata->>'department') = public.norm_dept(filter->>'department')
                   or public.norm_text(d.metadata->>'department') in ('all', 'company', 'all departments')))
          -- department heads: every document of their own department, whatever the position
          or (lower(coalesce(filter->>'head', '')) = 'true'
              and public.norm_dept(d.metadata->>'department') = public.norm_dept(filter->>'department'))
        )
      order by d.embedding operator(%3$I.<=>) query_embedding
      limit coalesce(match_count, 10)
    $body$
  $f$, emb_type, id_type, vec_schema);
  execute format('revoke all on function public.match_documents_scoped(%s, int, jsonb) from public, anon, authenticated', emb_type);
  execute format('grant execute on function public.match_documents_scoped(%s, int, jsonb) to service_role', emb_type);
end $$;

commit;
